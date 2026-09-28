import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { skip, smtp, startTestApp, until, wait } from "./helpers.js";

const decode = (m) => m.body.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
const confirmLink = (m) => decode(m).match(/https?:\/\/[^\s"<]+\/api\/subscribe\/confirm\/[a-f0-9]{48}/)[0];

describe("public sign-up (double opt-in) + email status", { skip }, () => {
  let app;
  let cookie;
  before(async () => {
    app = await startTestApp(fileURLToPath(import.meta.url));
    ({ cookie } = await app.login());
  });
  after(() => app?.stop());

  const signup = (body) => app.call("/api/subscribe", { method: "POST", body, csrf: false });
  const subscriber = (email) => app.mongoose.connection.db.collection("subscribers").findOne({ email });

  test("sign-up sends a confirmation email; not active until confirmed; GET doesn't confirm, POST does", async () => {
    const res = await signup({ email: "Student@Example.com", preference: "Results only" });
    assert.equal(res.status, 202);
    assert.match(res.json.message, /confirm/i);
    assert.equal((await subscriber("student@example.com")).active, false);

    const mail = await until(() => smtp.messages.find((m) => m.to.includes("student@example.com")));
    assert.match(decode(mail), /Subject: Confirm your Mathematical Olympiad updates/);
    const link = new URL(confirmLink(mail));

    const page = await app.call(link.pathname, { csrf: false });
    assert.equal(page.status, 200);
    assert.match(page.text, /Yes, confirm/);
    assert.equal((await subscriber("student@example.com")).active, false, "opening the link alone does not subscribe");

    const done = await app.call(link.pathname, { method: "POST", csrf: false, body: "", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    assert.equal(done.status, 200);
    const s = await subscriber("student@example.com");
    assert.equal(s.active, true);
    assert.equal(s.preference, "Results only");
    assert.equal(s.confirmToken, undefined);
    assert.equal((await app.call(link.pathname, { csrf: false })).status, 404, "link works once");
  });

  test("unconfirmed sign-ups receive no news; confirmed ones do", async () => {
    await signup({ email: "pending@example.com" });
    await until(() => smtp.messages.find((m) => m.to.includes("pending@example.com")));
    const before = smtp.messages.length;
    await app.call("/api/admin/news", {
      method: "POST",
      cookie,
      body: { title: "Round 1 results", shortDescription: "Merit list out", fullDescription: "f", level: "Senior", category: "Result", status: "published", sendEmailNotification: true }
    });
    await until(() => smtp.messages.length > before);
    await wait(500);
    const news = smtp.messages.slice(before);
    assert.deepEqual(news.flatMap((m) => m.to), ["student@example.com"]);
    const body = decode(news[0]);
    assert.match(body, /Subject: New Mathematical Olympiad update: Round 1 results/);
    assert.match(body, /Content-Type: text\/html/, "HTML version included");
    assert.match(body, /Read the full update/);
  });

  test("a stranger can't change an existing subscriber, and the reply reveals nothing", async () => {
    const before = smtp.messages.length;
    const res = await signup({ email: "student@example.com", preference: "All updates" });
    assert.equal(res.status, 202);
    assert.match(res.json.message, /confirm/i, "same reply as for new addresses");
    await wait(300);
    assert.equal((await subscriber("student@example.com")).preference, "Results only", "unchanged");
    assert.equal(smtp.messages.length, before, "no email sent");
  });

  test("at most 3 confirmation emails per address per day", async () => {
    for (let i = 0; i < 5; i += 1) await signup({ email: "victim@example.com" });
    await wait(500);
    assert.equal(smtp.messages.filter((m) => m.to.includes("victim@example.com")).length, 3);
  });

  test("validation and bad links", async () => {
    assert.equal((await signup({ email: "not-an-email" })).status, 400);
    for (const trick of ["a,victim@example.com", "x<victim@example.com>", '"v"@example.com', "a victim@example.com", "v@example.com;w@example.com"]) {
      assert.equal((await signup({ email: trick })).status, 400, `rejects ${trick}`);
    }
    assert.equal((await signup({ email: { $ne: "" } })).status, 400);
    assert.equal((await signup({ email: "a@b.co", preference: "Hacker" })).status, 400);
    assert.equal((await app.call("/api/subscribe/confirm/abc", { csrf: false })).status, 404);
    const users = (await app.call("/api/admin/users", { cookie })).json;
    assert.ok(users.every((u) => u.confirmToken === undefined && u.unsubscribeToken === undefined), "tokens never exposed");
  });

  test("dashboard email status shows provider, sender and a running worker", async () => {
    const { email } = (await app.call("/api/admin/system", { cookie })).json;
    assert.equal(email.configured, true);
    assert.equal(email.worker.started, true);
    assert.ok(email.worker.lastCheckAt, "worker has polled");
    assert.ok(email.from);
    assert.equal(typeof email.sentToday, "number");
  });
});
