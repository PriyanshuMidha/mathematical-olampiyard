import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { skip, startTestApp, until } from "./helpers.js";

describe("content: news, results, taxonomy, uploads, caching", { skip }, () => {
  let app;
  let cookie;
  before(async () => {
    app = await startTestApp(fileURLToPath(import.meta.url));
    ({ cookie } = await app.login());
  });
  after(() => app?.stop());

  const news = (extra = {}) => ({ title: "Round 1", shortDescription: "s", fullDescription: "f", level: "Junior", category: "General", status: "published", ...extra });

  test("health and security headers", async () => {
    const res = await app.call("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.json.db, "up");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  test("validates input and blocks injection / unsafe links", async () => {
    const cases = [
      [news({ level: { $ne: "" } }), 400],
      [news({ level: "Galaxy" }), 400],
      [news({ externalLink: "javascript:alert(1)" }), 400],
      [news({ title: "x".repeat(300) }), 400],
      [{ title: "only title", level: "Junior" }, 400]
    ];
    for (const [body, status] of cases) {
      assert.equal((await app.call("/api/admin/news", { method: "POST", cookie, body })).status, status, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await app.call("/api/admin/news/not-an-id", { cookie })).status, 400);
    assert.equal((await app.call("/api/admin/news/64b000000000000000000000", { cookie })).status, 404);
    assert.equal((await app.call("/api/news?level[$ne]=x")).status, 200);
  });

  test("unique slugs, stable on title edit, partial updates keep flags", async () => {
    const a = await app.call("/api/admin/news", { method: "POST", cookie, body: news({ isCurrent: true }) });
    const b = await app.call("/api/admin/news", { method: "POST", cookie, body: news() });
    assert.equal(a.json.news.slug, "round-1");
    assert.equal(b.json.news.slug, "round-1-2");
    const edited = await app.call(`/api/admin/news/${a.json.news._id}`, { method: "PUT", cookie, body: { title: "Renamed" } });
    assert.equal(edited.json.news.slug, "round-1");
    assert.equal(edited.json.news.isCurrent, true);
  });

  test("public list is paged and cache is invalidated on write", async () => {
    for (let i = 0; i < 5; i += 1) await app.call("/api/admin/news", { method: "POST", cookie, body: news({ title: `Page item ${i}` }) });
    const page1 = await app.call("/api/news?limit=3&page=1");
    const page2 = await app.call("/api/news?limit=3&page=2");
    assert.equal(page1.json.length, 3);
    assert.ok(page2.json.length >= 3);
    assert.equal(page1.json[0].fullDescription, undefined, "list returns card fields only");

    const before = (await app.call("/api/news?level=Senior")).json.length;
    await app.call("/api/admin/news", { method: "POST", cookie, body: news({ level: "Senior", title: "Senior news" }) });
    assert.equal((await app.call("/api/news?level=Senior")).json.length, before + 1);
  });

  test("cache picks up changes made by another instance (via CacheVersion)", async () => {
    const first = (await app.call("/api/results")).json.length;
    // Simulate another instance: write directly to the DB and bump the shared version doc.
    const db = app.mongoose.connection.db;
    await db.collection("results").insertOne({ title: "From B", level: "Junior", year: 2026, status: "published", publishedAt: new Date() });
    assert.equal((await app.call("/api/results")).json.length, first, "still cached");
    await db.collection("cacheversions").updateOne({ _id: "results" }, { $inc: { v: 1 }, $set: { prefixes: ["results:"] } }, { upsert: true });
    await until(async () => (await app.call("/api/results")).json.length === first + 1);
  });

  test("uploads: MIME allowlist, extension from MIME, cleanup on failure and delete", async () => {
    const form = (fields, file) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      if (file) fd.append("file", new Blob([file.content], { type: file.type }), file.name);
      return fd;
    };
    const html = await app.call("/api/admin/media", { method: "POST", cookie, form: form({}, { content: "<script>", type: "text/html", name: "x.html" }) });
    assert.equal(html.status, 400);

    const fakeImage = await app.call("/api/admin/media", { method: "POST", cookie, form: form({}, { content: "not really a png", type: "image/png", name: "x.png" }) });
    assert.equal(fakeImage.status, 400, "broken/fake images are rejected");

    const tinyPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#f00" } }).png().toBuffer();
    const disguised = await app.call("/api/admin/media", { method: "POST", cookie, form: form({}, { content: tinyPng, type: "image/png", name: "evil.html" }) });
    assert.equal(disguised.status, 201);
    assert.match(disguised.json.url, /\/evil-[a-f0-9]{24}\.(png|webp)$/, "extension from MIME type, never .html");

    const failed = await app.call("/api/admin/results", {
      method: "POST",
      cookie,
      form: form({ title: "Bad", level: "Nope", year: "2026" }, { content: "%PDF", type: "application/pdf", name: "a.pdf" })
    });
    assert.equal(failed.status, 400);

    const ok = await app.call("/api/admin/results", {
      method: "POST",
      cookie,
      form: form({ title: "Good", level: "Junior", year: "2026", status: "published" }, { content: "%PDF-1.4", type: "application/pdf", name: "a.pdf" })
    });
    assert.equal(ok.status, 201);
    const filePath = new URL(ok.json.fileUrl).pathname;
    const served = await fetch(`${app.base}${filePath}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "application/pdf");

    assert.equal((await app.call(`/api/admin/results/${ok.json._id}`, { method: "DELETE", cookie })).status, 200);
    assert.equal((await fetch(`${app.base}${filePath}`)).status, 404, "file removed with record");
  });

  test("large photos are resized to max 1600px WebP and EXIF is stripped", async () => {
    const photo = await sharp({ create: { width: 4000, height: 3000, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } })
      .jpeg({ quality: 95 })
      .withMetadata({ exif: { IFD0: { Copyright: "secret-gps-test" } } })
      .toBuffer();
    const fd = new FormData();
    fd.append("file", new Blob([photo], { type: "image/jpeg" }), "phone-photo.jpg");
    const res = await app.call("/api/admin/media", { method: "POST", cookie, form: fd });
    assert.equal(res.status, 201);
    assert.equal(res.json.mimeType, "image/webp");
    assert.ok(res.json.size < photo.length / 3, `stored ${res.json.size} B vs original ${photo.length} B`);
    const stored = fs.readFileSync(path.join(process.env.UPLOAD_DIR, path.basename(res.json.url)));
    const meta = await sharp(stored).metadata();
    assert.equal(meta.width, 1600);
    assert.equal(meta.exif, undefined, "metadata removed");
  });

  test("identical uploads are stored once and kept while any record uses them", async () => {
    const pdf = Buffer.from("%PDF-1.4 same syllabus " + "x".repeat(2000));
    const make = (title) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ title, level: "Junior", year: "2026", status: "published" })) fd.append(k, v);
      fd.append("file", new Blob([pdf], { type: "application/pdf" }), "syllabus.pdf");
      return app.call("/api/admin/results", { method: "POST", cookie, form: fd });
    };
    const before = fs.readdirSync(process.env.UPLOAD_DIR).length;
    const a = await make("Copy A");
    const b = await make("Copy B");
    assert.equal(a.json.fileUrl, b.json.fileUrl, "same stored file");
    assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, before + 1, "stored once");

    const filePath = new URL(a.json.fileUrl).pathname;
    await app.call(`/api/admin/results/${a.json._id}`, { method: "DELETE", cookie });
    assert.equal((await fetch(`${app.base}${filePath}`)).status, 200, "still used by Copy B");
    await app.call(`/api/admin/results/${b.json._id}`, { method: "DELETE", cookie });
    assert.equal((await fetch(`${app.base}${filePath}`)).status, 404, "removed when nothing uses it");
  });

  test("taxonomy in use cannot be deleted", async () => {
    const list = (await app.call("/api/admin/taxonomies", { cookie })).json;
    const junior = list.find((t) => t.name === "Junior");
    assert.equal((await app.call(`/api/admin/taxonomies/${junior._id}`, { method: "DELETE", cookie })).status, 409);
    const created = await app.call("/api/admin/taxonomies", { method: "POST", cookie, body: { type: "level", name: "Unused" } });
    assert.equal((await app.call(`/api/admin/taxonomies/${created.json._id}`, { method: "DELETE", cookie })).status, 200);
  });

  test("meta exposes backend option lists", async () => {
    const meta = (await app.call("/api/meta")).json;
    assert.ok(meta.resourceTypes.includes("Syllabus"));
    assert.ok(meta.userPreferences.includes("All updates"));
  });
});
