import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { skip, smtp, startTestApp, until, wait } from "./helpers.js";

// Free email plans cap sends per day (Brevo 300). With NOTIFY_DAILY_LIMIT the worker sends up to the
// cap, pauses, and resumes after midnight UTC without skipping or repeating anyone.
describe("daily email limit", { skip }, () => {
  let app;
  let cookie;
  before(async () => {
    app = await startTestApp(fileURLToPath(import.meta.url), { NOTIFY_DAILY_LIMIT: "3", NOTIFY_BATCH_SIZE: "2" });
    ({ cookie } = await app.login());
    for (let i = 1; i <= 5; i += 1) {
      await app.call("/api/admin/users", { method: "POST", cookie, body: { name: `User ${i}`, email: `u${i}@x.io` } });
    }
  });
  after(() => app?.stop());

  test("sends up to the limit, pauses until midnight UTC, then finishes the rest exactly once", async () => {
    const db = app.mongoose.connection.db;
    const res = await app.call("/api/admin/news", {
      method: "POST",
      cookie,
      body: { title: "Limit test", shortDescription: "s", fullDescription: "f", level: "Junior", category: "General", status: "published", sendEmailNotification: true }
    });
    assert.equal(res.json.emailResult.queued, true);

    await until(() => smtp.messages.length === 3);
    await wait(800);
    assert.equal(smtp.messages.length, 3, "stopped at the daily limit");
    const job = await until(async () => {
      const j = await db.collection("emailjobs").findOne({});
      return j?.lastError?.startsWith("Daily email limit") ? j : null;
    });
    assert.equal(job.status, "sending");
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    assert.equal(job.lockedUntil.getTime(), midnight.getTime(), "resumes at next UTC midnight");

    // Simulate the next day: the daily counter resets and the lock has expired.
    await db.collection("ratelimithits").deleteMany({ _id: /^email-daily/ });
    await db.collection("emailjobs").updateOne({ _id: job._id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });

    await until(async () => (await db.collection("emailjobs").findOne({ _id: job._id })).status === "sent");
    const recipients = smtp.messages.flatMap((m) => m.to).sort();
    assert.deepEqual(recipients, ["u1@x.io", "u2@x.io", "u3@x.io", "u4@x.io", "u5@x.io"], "everyone exactly once");
    const done = await db.collection("emailjobs").findOne({ _id: job._id });
    assert.equal(done.sent, 5);
    assert.equal(done.lastError, null);
  });
});
