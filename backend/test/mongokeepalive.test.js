import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { skip, startTestApp } from "./helpers.js";

describe("MongoDB keep-alive job", { skip }, () => {
  let app;
  let cookie;
  before(async () => {
    app = await startTestApp(fileURLToPath(import.meta.url), { JOBS_ENABLED: "false" });
    ({ cookie } = await app.login());
  });
  after(() => app?.stop());

  test("is registered, runs on demand, writes a real document, and shows up in /system", async () => {
    const before = (await app.call("/api/admin/system", { cookie })).json;
    assert.ok(before.jobs.some((j) => j.name === "mongo-keepalive"), "job is registered");

    const run = await app.call("/api/admin/system/jobs/mongo-keepalive/run", { method: "POST", cookie });
    assert.equal(run.status, 200);
    assert.ok(run.json.result.pingedAt);
    assert.equal(run.json.result.totalPings, 1);

    const doc = await app.mongoose.connection.db.collection("mongokeepalives").findOne({ _id: "keepalive" });
    assert.equal(doc.pings, 1);
    assert.ok(doc.lastPingAt);

    const again = await app.call("/api/admin/system/jobs/mongo-keepalive/run", { method: "POST", cookie });
    assert.equal(again.json.result.totalPings, 2, "counter increments on each run");

    const after = (await app.call("/api/admin/system", { cookie })).json;
    const job = after.jobs.find((j) => j.name === "mongo-keepalive");
    assert.ok(job.lastRunAt);
    assert.equal(job.lastResult.totalPings, 2);
  });

  test("running an unknown job name is refused", async () => {
    const res = await app.call("/api/admin/system/jobs/not-a-real-job/run", { method: "POST", cookie });
    assert.equal(res.status, 400);
  });
});
