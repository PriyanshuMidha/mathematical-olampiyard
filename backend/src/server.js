import { assertConfig, config } from "./config/env.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { createApp } from "./app.js";
import { startCacheSync, stopCacheSync } from "./core/contentChanged.js";
import { startScheduler, stopScheduler } from "./core/scheduler.js";
import { closeTransport } from "./modules/notifications/mailer.js";
import { startNotificationWorker, stopNotificationWorker } from "./modules/notifications/worker.js";

process.on("unhandledRejection", (reason) => console.error("Unhandled promise rejection:", reason));

async function start() {
  assertConfig();
  await connectDB();

  const server = createApp().listen(config.port, () => console.log(`API running on http://localhost:${config.port}`));
  // Slightly above typical load-balancer idle timeouts to avoid 502s on reused connections.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${config.port} is already in use - the API is probably already running in another terminal.\n` +
          `Stop it (Ctrl+C there, or: kill $(lsof -tiTCP:${config.port} -sTCP:LISTEN)) or set a different PORT in backend/.env.`
      );
    } else {
      console.error("Server error", error);
    }
    process.exit(1);
  });

  startNotificationWorker();
  await startCacheSync();
  startScheduler();

  // Graceful shutdown: stop taking requests, finish in-flight ones, then close DB/SMTP.
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, shutting down...`);
    stopNotificationWorker();
    stopCacheSync();
    stopScheduler();
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(async () => {
      closeTransport();
      await disconnectDB().catch(() => {});
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => {
  console.error("Failed to start server:", error.message || error);
  process.exit(1);
});
