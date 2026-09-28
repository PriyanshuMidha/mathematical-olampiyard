// Test harness: boots the real app on a random port against a throwaway database.
// Requires TEST_MONGODB_URI (e.g. mongodb://127.0.0.1:27017) — each test file uses its own database.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const MONGO = process.env.TEST_MONGODB_URI;
export const skip = !MONGO && "TEST_MONGODB_URI not set";

export const ADMIN = { email: "tester", password: "Test-password-123" };
// down=true simulates a provider outage (451 on every message); reject = addresses answered with 550.
export const smtp = { messages: [], down: false, reject: new Set() };

function startFakeSmtp() {
  const server = net.createServer((socket) => {
    let data = false;
    let current = { to: [], body: "" };
    const write = (line) => socket.write(`${line}\r\n`);
    write("220 fake-smtp");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line === ".") {
            data = false;
            smtp.messages.push(current);
            current = { to: [], body: "" };
            write("250 ok");
          } else current.body += `${line}\n`;
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO")) socket.write("250-fake\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (cmd.startsWith("AUTH")) write("235 ok");
        else if (cmd.startsWith("MAIL") && smtp.down) write("451 Temporary failure, try again later");
        else if (cmd.startsWith("RCPT")) {
          const rcpt = line.slice(line.indexOf(":") + 1).trim().replace(/[<>]/g, "");
          if (smtp.reject.has(rcpt)) {
            write("550 Mailbox does not exist");
            continue;
          }
          current.to.push(rcpt);
          write("250 ok");
        } else if (cmd.startsWith("DATA")) {
          data = true;
          write("354 go");
        } else if (cmd.startsWith("QUIT")) {
          write("221 bye");
          socket.end();
        } else write("250 ok");
      }
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export async function startTestApp(testFile, extraEnv = {}) {
  const smtpServer = await startFakeSmtp();
  const dbName = `test_${path.basename(testFile, ".test.js")}_${process.pid}`;
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: `${MONGO.replace(/\/$/, "")}/${dbName}`,
    JWT_SECRET: "t".repeat(48),
    CLIENT_URL: "http://localhost:5173",
    API_URL: "http://localhost:0",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtpServer.address().port),
    SMTP_USER: "u",
    SMTP_PASS: "p",
    NOTIFY_POLL_MS: "200",
    NOTIFY_BATCH_SIZE: "2",
    CACHE_SYNC_MS: "200",
    MONGO_MIN_POOL_SIZE: "1",
    API_RATE_LIMIT_PER_MIN: "0",
    UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "olympiad-uploads-")),
    ...extraEnv
  });

  // Imported only now, because config is read once at import time.
  const { connectDB, disconnectDB } = await import("../src/config/db.js");
  const { createApp } = await import("../src/app.js");
  const { startNotificationWorker, stopNotificationWorker } = await import("../src/modules/notifications/worker.js");
  const { startCacheSync, stopCacheSync } = await import("../src/core/contentChanged.js");
  const { closeTransport } = await import("../src/modules/notifications/mailer.js");
  const mongoose = (await import("mongoose")).default;
  const bcrypt = (await import("bcryptjs")).default;
  const Admin = (await import("../src/modules/auth/admin.model.js")).default;
  const Taxonomy = (await import("../src/modules/taxonomy/taxonomy.model.js")).default;

  await connectDB();
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await Admin.create({ email: ADMIN.email, name: "Tester", passwordHash: await bcrypt.hash(ADMIN.password, 4) });
  await Taxonomy.insertMany([
    ...["Junior", "Senior"].map((name) => ({ type: "level", name })),
    ...["Result", "Exam Date", "General"].map((name) => ({ type: "category", name }))
  ]);

  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  startNotificationWorker();
  await startCacheSync();

  async function call(pathname, { method = "GET", body, cookie, csrf = true, headers = {}, form } = {}) {
    const init = { method, headers: { ...headers }, redirect: "manual" };
    if (csrf) init.headers["X-Requested-With"] = "olympiad-cms";
    if (cookie) init.headers.Cookie = cookie;
    if (form) init.body = form;
    else if (body !== undefined) {
      init.headers["Content-Type"] ||= "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(`${base}${pathname}`, init);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text, headers: res.headers };
  }

  async function login(credentials = ADMIN) {
    const res = await call("/api/admin/login", { method: "POST", body: credentials });
    const setCookie = res.headers.get("set-cookie") || "";
    return { res, cookie: setCookie.split(";")[0] };
  }

  async function stop() {
    stopNotificationWorker();
    stopCacheSync();
    closeTransport();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    smtpServer.close();
    await mongoose.connection.db.dropDatabase().catch(() => {});
    await disconnectDB();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
  }

  return { base, call, login, stop, mongoose };
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(check, { timeout = 5000, every = 100 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error("Timed out waiting for condition");
    await wait(every);
  }
}
