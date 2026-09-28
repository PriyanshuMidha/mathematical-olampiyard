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

  test("a resumed job skips recipients already handled", async () => {
    const db = app.mongoose.connection.db;
    const created = await app.call("/api/admin/news", {
      method: "POST",
      cookie,
      body: { title: "Exam dates", shortDescription: "s", fullDescription: "f", level: "Junior", category: "Exam Date", status: "published", sendEmailNotification: true }
    });
    const job = await until(() => db.collection("emailjobs").findOne({ newsId: new app.mongoose.Types.ObjectId(created.json.news._id) }));
    await until(async () => (await db.collection("emailjobs").findOne({ _id: job._id })).status === "sent");
    const sentBefore = smtp.messages.length;

    // Pretend the job crashed mid-way and is picked up again: nobody may get it twice.
    await db.collection("emailjobs").updateOne({ _id: job._id }, { $set: { status: "queued", cursor: null, lockedUntil: null } });
    await wait(800);
    assert.equal(smtp.messages.length, sentBefore);
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
