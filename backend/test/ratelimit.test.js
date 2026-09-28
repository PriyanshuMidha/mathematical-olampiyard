import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ADMIN, skip, startTestApp } from "./helpers.js";

describe("rate limiting", { skip }, () => {
  let app;
  before(async () => (app = await startTestApp(fileURLToPath(import.meta.url), { API_RATE_LIMIT_PER_MIN: "20", TRUST_PROXY: "1" })));
  after(() => app?.stop());

  const as = (ip) => ({ headers: { "X-Forwarded-For": ip } });

  test("per-client API limit with standard headers; other clients unaffected; health never limited", async () => {
    let last;
    for (let i = 0; i < 21; i += 1) last = await app.call("/api/taxonomies", as("203.0.113.5"));
    assert.equal(last.status, 429);
    const retry = Number(last.headers.get("retry-after"));
    assert.ok(retry >= 1 && retry <= 60, `Retry-After ${retry}`);
    assert.equal(last.headers.get("ratelimit-remaining"), "0");
    assert.equal((await app.call("/api/taxonomies", as("198.51.100.7"))).status, 200, "different client still fine");
    assert.equal((await app.call("/api/health", as("203.0.113.5"))).status, 200);
  });

  test("IPv6 clients are grouped by /64", async () => {
    for (let i = 0; i < 20; i += 1) await app.call("/api/taxonomies", as(`2001:db8:1:2::${i + 1}`));
    assert.equal((await app.call("/api/taxonomies", as("2001:db8:1:2:ffff::9"))).status, 429, "same /64, new address");
    assert.equal((await app.call("/api/taxonomies", as("2001:db8:1:3::1"))).status, 200, "different /64");
  });

  test("an attacker can't lock the real admin out from another network", async () => {
    for (let i = 0; i < 11; i += 1) {
      await app.call("/api/admin/login", { method: "POST", body: { email: ADMIN.email, password: `wrong${i}` }, ...as("192.0.2.66") });
    }
    const attacker = await app.call("/api/admin/login", { method: "POST", body: ADMIN, ...as("192.0.2.66") });
    assert.equal(attacker.status, 429, "attacker's network is locked for this account");
    const realAdmin = await app.call("/api/admin/login", { method: "POST", body: ADMIN, ...as("192.0.2.10") });
    assert.equal(realAdmin.status, 200, "admin from their own network can still log in");
  });
  test("guesses spread over many networks can't lock out an admin's usual network", async () => {
    // Admin logs in normally from their office network once (marks it as trusted).
    assert.equal((await app.call("/api/admin/login", { method: "POST", body: ADMIN, ...as("198.51.100.200") })).status, 200);
    // Attacker: 10 guesses from each of 10 networks = account-wide ceiling of 100 failures.
    for (let net = 1; net <= 10; net += 1) {
      for (let i = 0; i < 10; i += 1) {
        await app.call("/api/admin/login", { method: "POST", body: { email: ADMIN.email, password: `x${net}-${i}` }, ...as(`100.64.${net}.1`) });
      }
    }
    const unknownNetwork = await app.call("/api/admin/login", { method: "POST", body: ADMIN, ...as("192.0.2.200") });
    assert.equal(unknownNetwork.status, 429, "new networks are blocked while under attack");
    const office = await app.call("/api/admin/login", { method: "POST", body: ADMIN, ...as("198.51.100.200") });
    assert.equal(office.status, 200, "the admin's usual network still works");
  });
});
