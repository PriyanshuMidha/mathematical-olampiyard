import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { skip, smtp, startTestApp, wait } from "./helpers.js";

// Sign-up confirmations have their own small budget so fake sign-ups can't eat the news quota.
describe("confirmation email budget", { skip }, () => {
  let app;
  before(async () => (app = await startTestApp(fileURLToPath(import.meta.url), { NOTIFY_DAILY_LIMIT: "10" })));
  after(() => app?.stop());

  test("confirmations are capped at 20% of the daily limit", async () => {
    for (let i = 0; i < 6; i += 1) await app.call("/api/subscribe", { method: "POST", csrf: false, body: { email: `fake${i}@example.com` } });
    await wait(1500);
    assert.equal(smtp.messages.length, 2, "only 2 of 10 daily emails may be confirmations");
  });
});
