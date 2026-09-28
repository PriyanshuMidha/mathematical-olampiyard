import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { skip, smtp, startTestApp, until, wait } from "./helpers.js";

describe("users, email queue, unsubscribe", { skip }, () => {
  let app;
  let cookie;
  before(async () => {
    app = await startTestApp(fileURLToPath(import.meta.url));
    ({ cookie } = await app.login());
    const users = [
      ["All 1", "all1@x.io", "All updates"],
      ["All 2", "all2@x.io", "All updates"],
      ["All 3", "all3@x.io", "All updates"],
      ["Results", "res@x.io", "Results only"],
      ["Exams", "exam@x.io", "Exam dates"]
    ];
    for (const [name, email, preference] of users) {
      const res = await app.call("/api/admin/users", { method: "POST", cookie, body: { name, email, preference } });
      assert.equal(res.status, 201);
      assert.equal(res.json.unsubscribeToken, undefined);
    }
  });
  after(() => app?.stop());

  test("user validation", async () => {
    assert.equal((await app.call("/api/admin/users", { method: "POST", cookie, body: { email: "x@x.io" } })).status, 400);
    assert.equal((await app.call("/api/admin/users", { method: "POST", cookie, body: { name: "X", email: "bad" } })).status, 400);
    assert.equal((await app.call("/api/admin/users", { method: "POST", cookie, body: { name: "X", email: "ALL1@x.io" } })).status, 409);
  });

  test("publishing queues one email per matching user, never twice", async () => {
    const created = await app.call("/api/admin/news", {
      method: "POST",
      cookie,
      body: { title: "Result out", shortDescription: "s", fullDescription: "f", level: "Senior", category: "Result", status: "draft", sendEmailNotification: true }
    });
    assert.deepEqual(created.json.emailResult, { skipped: true }, "drafts are not emailed");

    const id = created.json.news._id;
    // Two publishes at the same moment must still produce one job.
    const [a, b] = await Promise.all([
      app.call(`/api/admin/news/${id}`, { method: "PUT", cookie, body: { status: "published" } }),
      app.call(`/api/admin/news/${id}`, { method: "PUT", cookie, body: { status: "published" } })
    ]);
    assert.equal(a.json.emailResult.queued, true);
    assert.equal(b.json.emailResult.queued, true);

    await until(async () => (await app.call(`/api/admin/news/${id}`, { cookie })).json.emailSentAt);
    const recipients = smtp.messages.flatMap((m) => m.to).sort();
    assert.deepEqual(recipients, ["all1@x.io", "all2@x.io", "all3@x.io", "res@x.io"], "preferences respected, no duplicates");
    const decoded = smtp.messages[0].body.replace(/=\n/g, "");
    assert.match(decoded, /Hi All \d,/);
    assert.match(decoded, /Unsubscribe: http:\/\/localhost:0\/api\/unsubscribe\/[a-f0-9]{48}/);
    assert.match(smtp.messages[0].body, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);

    await app.call(`/api/admin/news/${id}`, { method: "PUT", cookie, body: { title: "Result out (edited)" } });
    await wait(600);
    assert.equal(smtp.messages.length, 4, "editing does not resend");
  });

  test("a job resumed after a crash skips recipients already handled, then cleans up", async () => {
    const db = app.mongoose.connection.db;
    const { ObjectId } = app.mongoose.Types;
    const users = await db.collection("subscribers").find({ email: { $in: ["all1@x.io", "all2@x.io"] } }).toArray();
    // A job that crashed after emailing all1 + all2: its lock has expired and delivery rows exist.
    const jobId = new ObjectId();
    await db.collection("emaildeliveries").insertMany(users.map((u) => ({ jobId, subscriberId: u._id, createdAt: new Date() })));
    const sentBefore = smtp.messages.length;
    await db.collection("emailjobs").insertOne({
      _id: jobId,
      newsId: new ObjectId(),
      news: { title: "Exam dates", slug: "exam-dates", shortDescription: "s", level: "Junior", category: "Exam Date" },
      status: "sending",
      attempts: 1,
      sent: 2,
      failed: 0,
      lockedUntil: new Date(Date.now() - 1000),
      createdAt: new Date()
    });
    await until(async () => (await db.collection("emailjobs").findOne({ _id: jobId })).status === "sent");
    const resumed = smtp.messages.slice(sentBefore).flatMap((m) => m.to).sort();
    assert.deepEqual(resumed, ["all3@x.io", "exam@x.io"], "only the users not yet emailed");
    assert.equal(await db.collection("emaildeliveries").countDocuments({ jobId }), 0, "delivery rows removed after finishing");
    const job = await db.collection("emailjobs").findOne({ _id: jobId });
    assert.equal(job.news, undefined, "email snapshot dropped after sending");
  });

  test("provider outage: nothing is lost, the job retries and finishes once the provider is back", async () => {
    const db = app.mongoose.connection.db;
    smtp.down = true;
    const before = smtp.messages.length;
    const created = await app.call("/api/admin/news", {
      method: "POST",
      cookie,
      body: { title: "Outage test", shortDescription: "s", fullDescription: "f", level: "Junior", category: "General", status: "published", sendEmailNotification: true }
    });
    const newsId = new app.mongoose.Types.ObjectId(created.json.news._id);
    const job = await until(async () => {
      const j = await db.collection("emailjobs").findOne({ newsId });
      return j?.lastError?.includes("will retry") ? j : null;
    });
    assert.equal(job.status, "sending", "not marked sent while the provider is down");
    assert.ok(job.lockedUntil > new Date(), "retry scheduled for later");
    assert.equal((await app.call(`/api/admin/news/${created.json.news._id}`, { cookie })).json.emailSentAt, undefined);

    smtp.down = false;
    await db.collection("emailjobs").updateOne({ _id: job._id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
    await until(async () => (await db.collection("emailjobs").findOne({ _id: job._id })).status === "sent");
    assert.ok(smtp.messages.length > before, "emails delivered after recovery");
  });

  test("an address the provider rejects is skipped, everyone else still gets the email", async () => {
    const db = app.mongoose.connection.db;
    smtp.reject.add("all2@x.io");
    const before = smtp.messages.length;
    const created = await app.call("/api/admin/news", {
      method: "POST",
      cookie,
      body: { title: "Bounce test", shortDescription: "s", fullDescription: "f", level: "Junior", category: "General", status: "published", sendEmailNotification: true }
    });
    const newsId = new app.mongoose.Types.ObjectId(created.json.news._id);
    const job = await until(async () => {
      const j = await db.collection("emailjobs").findOne({ newsId });
      return j?.status === "sent" ? j : null;
    });
    smtp.reject.clear();
    assert.ok(job.failed >= 1, "rejected address counted as failed");
    assert.ok(!smtp.messages.slice(before).some((m) => m.to.includes("all2@x.io")));
    assert.ok(smtp.messages.slice(before).some((m) => m.to.includes("all3@x.io")));
  });

  test("unsubscribe: GET only confirms, POST unsubscribes", async () => {
    const db = app.mongoose.connection.db;
    const user = await db.collection("subscribers").findOne({ email: "all1@x.io" });
    const page = await app.call(`/api/unsubscribe/${user.unsubscribeToken}`, { csrf: false });
    assert.equal(page.status, 200);
    assert.match(page.text, /<form method="post">/);
    assert.equal((await db.collection("subscribers").findOne({ _id: user._id })).active, true);

    const done = await app.call(`/api/unsubscribe/${user.unsubscribeToken}`, { method: "POST", csrf: false, body: "List-Unsubscribe=One-Click", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    assert.equal(done.status, 200);
    assert.equal((await db.collection("subscribers").findOne({ _id: user._id })).active, false);
    assert.equal((await app.call("/api/unsubscribe/not-a-token", { csrf: false })).status, 404);
  });
});
