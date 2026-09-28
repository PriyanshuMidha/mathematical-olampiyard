import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
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

    const disguised = await app.call("/api/admin/media", { method: "POST", cookie, form: form({}, { content: "png", type: "image/png", name: "evil.html" }) });
    assert.equal(disguised.status, 201);
    assert.match(disguised.json.url, /evil\.png$/);

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
