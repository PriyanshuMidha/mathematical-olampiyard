import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ADMIN, skip, startTestApp } from "./helpers.js";

describe("auth & admin management", { skip }, () => {
  let app;
  before(async () => (app = await startTestApp(fileURLToPath(import.meta.url))));
  after(() => app?.stop());

  test("login sets an httpOnly cookie and never returns the token", async () => {
    const { res, cookie } = await app.login();
    assert.equal(res.status, 200);
    assert.equal(res.json.token, undefined);
    assert.equal(res.json.admin.email, ADMIN.email);
    const setCookie = res.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.ok(cookie.startsWith("olympiad_admin="));
    assert.equal((await app.call("/api/admin/me", { cookie })).status, 200);
  });

  test("admin routes need a session", async () => {
    assert.equal((await app.call("/api/admin/me")).status, 401);
    assert.equal((await app.call("/api/admin/me", { cookie: "olympiad_admin=garbage" })).status, 401);
    assert.equal((await app.call("/api/admin/me", { headers: { Authorization: "Bearer abc" } })).status, 401);
  });

  test("CSRF: writes need the custom header and an allowed Origin", async () => {
    const { cookie } = await app.login();
    const noHeader = await app.call("/api/admin/users", { method: "POST", cookie, csrf: false, body: { name: "A", email: "a@x.io" } });
    assert.equal(noHeader.status, 403);
    const badOrigin = await app.call("/api/admin/users", { method: "POST", cookie, headers: { Origin: "https://evil.example" }, body: { name: "A", email: "a@x.io" } });
    assert.equal(badOrigin.status, 403);
    const ok = await app.call("/api/admin/users", { method: "POST", cookie, headers: { Origin: "http://localhost:5173" }, body: { name: "A", email: "a@x.io" } });
    assert.equal(ok.status, 201);
  });

  test("rejects operator injection in login", async () => {
    const res = await app.call("/api/admin/login", { method: "POST", body: { email: { $ne: "" }, password: "x" } });
    assert.equal(res.status, 400);
  });

  test("locks an account after 10 failed attempts", async () => {
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await app.call("/api/admin/login", { method: "POST", body: { email: "victim", password: `wrong${i}` } })).status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.equal(statuses[10], 429);
  });

  test("admin CRUD, reset password revokes sessions, self/last-admin protection", async () => {
    const { cookie } = await app.login();
    const weak = await app.call("/api/admin/admins", { method: "POST", cookie, body: { email: "second", password: "short" } });
    assert.equal(weak.status, 400);
    const known = await app.call("/api/admin/admins", { method: "POST", cookie, body: { email: "second", password: "Admin@12345" } });
    assert.equal(known.status, 400);

    const created = await app.call("/api/admin/admins", { method: "POST", cookie, body: { name: "Second", email: "second", password: "Second-pass-123" } });
    assert.equal(created.status, 201);
    const dup = await app.call("/api/admin/admins", { method: "POST", cookie, body: { email: "SECOND", password: "Second-pass-123" } });
    assert.equal(dup.status, 409);

    const second = await app.login({ email: "second", password: "Second-pass-123" });
    assert.equal((await app.call("/api/admin/me", { cookie: second.cookie })).status, 200);

    const reset = await app.call(`/api/admin/admins/${created.json.id}/password`, { method: "PUT", cookie, body: { password: "Brand-new-pass-1" } });
    assert.equal(reset.status, 200);
    assert.equal((await app.call("/api/admin/me", { cookie: second.cookie })).status, 401, "old session revoked");

    const me = (await app.call("/api/admin/me", { cookie })).json.admin;
    assert.equal((await app.call(`/api/admin/admins/${me.id}`, { method: "DELETE", cookie })).status, 400, "cannot delete self");
    assert.equal((await app.call(`/api/admin/admins/${created.json.id}`, { method: "DELETE", cookie })).status, 200);
    assert.equal((await app.call("/api/admin/admins", { cookie })).json.length, 1);
  });

  test("changing my password logs out other sessions but keeps this one", async () => {
    const a = await app.login();
    const b = await app.login();
    const wrong = await app.call("/api/admin/me/password", { method: "POST", cookie: a.cookie, body: { currentPassword: "nope", newPassword: "Another-pass-123" } });
    assert.equal(wrong.status, 400);

    const changed = await app.call("/api/admin/me/password", { method: "POST", cookie: a.cookie, body: { currentPassword: ADMIN.password, newPassword: "Another-pass-123" } });
    assert.equal(changed.status, 200);
    const fresh = changed.headers.get("set-cookie").split(";")[0];
    assert.equal((await app.call("/api/admin/me", { cookie: b.cookie })).status, 401, "other session revoked");
    assert.equal((await app.call("/api/admin/me", { cookie: fresh })).status, 200, "current browser gets a new session");
    assert.equal((await app.login({ email: ADMIN.email, password: "Another-pass-123" })).res.status, 200);
  });

  test("logout clears the cookie", async () => {
    const res = await app.call("/api/admin/logout", { method: "POST" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("set-cookie"), /olympiad_admin=;/);
  });
});
