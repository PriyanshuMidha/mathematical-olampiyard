import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { startFakeS3 } from "./fakeS3.js";
import { skip, startTestApp } from "./helpers.js";

// Storage cap is set to 0.000001 GB = 1073 bytes so the limit is easy to hit.
const LIMIT = Math.floor(0.000001 * 1024 ** 3);

describe("Cloudflare R2 storage cap + scheduled jobs", { skip }, () => {
  let app;
  let s3;
  let cookie;
  const PUBLIC = "https://files.example.test";

  before(async () => {
    s3 = await startFakeS3();
    app = await startTestApp(fileURLToPath(import.meta.url), {
      R2_ENDPOINT: s3.endpoint,
      R2_ACCOUNT_ID: "acc",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "bucket",
      R2_PUBLIC_URL: PUBLIC,
      R2_STORAGE_LIMIT_GB: "0.000001",
      ORPHAN_GRACE_HOURS: "0",
      JOBS_ENABLED: "false"
    });
    ({ cookie } = await app.login());
  });
  after(async () => {
    await app?.stop();
    s3?.close();
  });

  const usage = async () => (await app.call("/api/admin/system", { cookie })).json.storage;
  const uploadResult = (bytes, title = "R") => {
    const fd = new FormData();
    fd.append("title", title);
    fd.append("level", "Junior");
    fd.append("year", "2026");
    fd.append("status", "published");
    fd.append("file", new Blob([Buffer.alloc(bytes, 1)], { type: "application/pdf" }), "f.pdf");
    return app.call("/api/admin/results", { method: "POST", cookie, form: fd });
  };
  const start = (fileSize) => app.call("/api/admin/uploads/r2/start", { method: "POST", cookie, body: { fileName: "big.pdf", fileType: "application/pdf", fileSize } });

  test("concurrent reservations never exceed the cap", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => start(200)));
    const accepted = results.filter((r) => r.status === 201);
    assert.equal(accepted.length, Math.floor(LIMIT / 200));
    assert.ok(results.some((r) => r.status === 507 && /storage is full/.test(r.json.message)));
    for (const r of accepted) await app.call("/api/admin/uploads/r2/abort", { method: "POST", cookie, body: { key: r.json.key } });
    assert.equal((await usage()).usedBytes, 0, "aborting gives the space back");
  });

  test("form uploads go to R2 and are counted; over-limit upload is refused and not stored", async () => {
    const a = await uploadResult(500, "A");
    assert.equal(a.status, 201);
    assert.ok(a.json.fileUrl.startsWith(`${PUBLIC}/results/`));
    assert.equal((await usage()).usedBytes, 500);
    assert.equal((await uploadResult(500, "B")).status, 201);
    const c = await uploadResult(500, "C");
    assert.equal(c.status, 507);
    assert.match(c.json.message, /Cloudflare storage is full/);
    assert.equal(s3.objects.size, 2);
    assert.equal((await usage()).usedBytes, 1000);

    assert.equal((await app.call(`/api/admin/results/${a.json._id}`, { method: "DELETE", cookie })).status, 200);
    assert.equal(s3.objects.size, 1, "R2 object deleted with the record");
    assert.equal((await usage()).usedBytes, 500);
  });

  test("direct upload: counted by real size; larger-than-declared upload over the cap is rejected", async () => {
    const ok = await start(100);
    assert.equal(ok.status, 201);
    assert.match(new URL(ok.json.uploadUrl).searchParams.get("X-Amz-SignedHeaders"), /content-length/, "size is part of the signature");
    s3.objects.set(ok.json.key, { body: Buffer.alloc(100), lastModified: new Date() });
    assert.equal((await app.call("/api/admin/uploads/r2/complete", { method: "POST", cookie, body: { key: ok.json.key } })).status, 200);
    assert.equal((await usage()).usedBytes, 600);

    const cheat = await start(10);
    s3.objects.set(cheat.json.key, { body: Buffer.alloc(900), lastModified: new Date() }); // uploads more than declared
    const res = await app.call("/api/admin/uploads/r2/complete", { method: "POST", cookie, body: { key: cheat.json.key } });
    assert.equal(res.status, 507);
    assert.equal(s3.objects.has(cheat.json.key), false);
    assert.equal((await usage()).usedBytes, 600);
  });

  test("storage-reconcile job recounts the bucket and aborts stale multipart uploads", async () => {
    await app.mongoose.connection.db.collection("storageusages").updateOne({ _id: "r2" }, { $set: { bytes: 999999 } });
    s3.uploads.set("stale", { key: "news/2026-01-01/1-a-old.pdf", parts: new Map(), initiated: new Date(Date.now() - 2 * 86400_000) });
    const run = await app.call("/api/admin/system/jobs/storage-reconcile/run", { method: "POST", cookie });
    assert.equal(run.status, 200);
    assert.equal(run.json.result.abortedMultipart, 1);
    const bucketBytes = [...s3.objects.values()].reduce((n, o) => n + o.body.length, 0);
    assert.equal((await usage()).usedBytes, bucketBytes);
    assert.equal(s3.uploads.size, 0);
  });

  test("orphan-file-cleanup deletes unreferenced files only", async () => {
    const orphanKey = "news/2026-01-01/1700000000000-deadbeef-orphan.pdf";
    s3.objects.set(orphanKey, { body: Buffer.alloc(50), lastModified: new Date(Date.now() - 3 * 86400_000) });
    for (const o of s3.objects.values()) o.lastModified = new Date(Date.now() - 3 * 86400_000);
    const uploadDir = process.env.UPLOAD_DIR;
    const localOrphan = path.join(uploadDir, "1700000000000-deadbeef-old.pdf");
    fs.writeFileSync(localOrphan, "x");
    fs.utimesSync(localOrphan, new Date(2020, 0, 1), new Date(2020, 0, 1));
    const before = s3.objects.size;

    const run = await app.call("/api/admin/system/jobs/orphan-file-cleanup/run", { method: "POST", cookie });
    assert.equal(run.status, 200);
    // Orphans: the planted file + the direct upload from the earlier test that was never attached to a record.
    assert.equal(run.json.result.r2Deleted, 2);
    assert.equal(run.json.result.localDeleted, 1);
    assert.equal(s3.objects.has(orphanKey), false);
    assert.equal(s3.objects.size, before - 2);
    assert.equal(fs.existsSync(localOrphan), false);
    const results = (await app.call("/api/admin/results", { cookie })).json;
    for (const r of results) assert.ok(s3.objects.has(new URL(r.fileUrl).pathname.slice(1)), "still-referenced file kept");
  });

  test("system endpoint reports jobs and storage", async () => {
    const system = (await app.call("/api/admin/system", { cookie })).json;
    assert.equal(system.storage.driver, "r2");
    assert.equal(system.storage.limitBytes, LIMIT);
    assert.deepEqual(system.jobs.map((j) => j.name).sort(), ["orphan-file-cleanup", "storage-reconcile"]);
    assert.ok(system.jobs.every((j) => j.lastRunAt));
    const dashboard = (await app.call("/api/admin/dashboard", { cookie })).json;
    assert.equal(dashboard.storage.driver, "r2");
  });
});
