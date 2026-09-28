import compression from "compression";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { config } from "./config/env.js";
import { isDbReady } from "./config/db.js";
import { AppError } from "./core/errors.js";
import { rateLimit } from "./core/rateLimit.js";
import { securityHeaders, uploadHeaders } from "./core/security.js";
import { requireAdmin, requireSameOriginWrite } from "./modules/auth/auth.middleware.js";
import { modules } from "./modules/index.js";
import { MAX_UPLOAD_MB, UPLOAD_DIR, removeStoredFile, requestFiles } from "./modules/uploads/storage.js";

function errorResponse(err) {
  if (err instanceof mongoose.Error.ValidationError) {
    return [400, Object.values(err.errors).map((e) => e.message).join(", ")];
  }
  if (err instanceof mongoose.Error.CastError) return [400, `Invalid ${err.path}`];
  if (err?.code === 11000) return [409, `Duplicate ${Object.keys(err.keyValue || {}).join(", ") || "value"}`];
  if (err instanceof multer.MulterError) {
    return [400, err.code === "LIMIT_FILE_SIZE" ? `File too large. Maximum upload size is ${MAX_UPLOAD_MB} MB.` : err.message];
  }
  if (err?.type === "entity.parse.failed") return [400, "Invalid JSON body"];
  if (err?.type === "entity.too.large") return [413, "Request body too large"];
  const status = err.status || err.statusCode || 500;
  // Our own AppErrors carry messages meant for the user (e.g. 507 storage full); anything else stays generic.
  return [status, err instanceof AppError || status < 500 ? err.message : "Something went wrong"];
}

export function createApp() {
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.set("etag", "strong");
  app.disable("x-powered-by");

  app.use(securityHeaders);
  app.use(cors({ origin: config.clientUrls, credentials: true, maxAge: 600 }));
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));

  // Behind a proxy without TRUST_PROXY every visitor looks like the proxy's IP, so all of them would
  // share one rate-limit bucket. Warn once so this can't silently cause site-wide 429s.
  let proxyWarned = false;
  app.use((req, _res, next) => {
    if (!proxyWarned && !config.trustProxy && req.headers["x-forwarded-for"]) {
      proxyWarned = true;
      console.warn("Warning: requests arrive through a proxy (X-Forwarded-For) but TRUST_PROXY is not set. Set TRUST_PROXY=1 so rate limits see real client IPs.");
    }
    next();
  });

  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - started;
      if (duration > config.slowRequestMs) console.warn(`Slow request: ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // File names contain a hash of their content, so a name never points to different bytes:
  // browsers/CDNs can cache them for a year and never re-download.
  app.use("/uploads", express.static(UPLOAD_DIR, { dotfiles: "deny", index: false, maxAge: "365d", immutable: true, setHeaders: uploadHeaders }));

  app.get("/api/health", (_req, res) => {
    const db = isDbReady();
    res.status(db ? 200 : 503).json({ ok: db, db: db ? "up" : "down", service: "mathematical-olympiad-cms" });
  });

  // Best-effort flood protection per instance (in memory, so it adds no DB round trip).
  // Kept generous: a whole school can share one public IP. 0 disables it.
  if (config.apiRateLimitPerMin > 0) {
    app.use("/api", rateLimit({ name: "api", windowMs: 60_000, max: config.apiRateLimitPerMin, store: config.apiRateLimitStore }));
  }

  const publicApi = express.Router();
  const adminApi = express.Router();
  adminApi.use(requireSameOriginWrite);
  for (const m of modules) {
    if (m.publicRouter) publicApi.use(m.publicRouter);
    if (m.openAdminRouter) adminApi.use(m.openAdminRouter);
  }
  adminApi.use(requireAdmin);
  for (const m of modules) if (m.adminRouter) adminApi.use(m.adminRouter);

  app.use("/api/admin", adminApi);
  app.use("/api", publicApi);
  app.use("/api", (_req, res) => res.status(404).json({ message: "Route not found" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    // A failed request must not leave its uploaded files behind - but a file it merely reused
    // (identical content already stored) may belong to other records and is left alone.
    requestFiles(req).filter((file) => !file.reused).forEach((file) => removeStoredFile(file.url));
    const [status, message] = errorResponse(err);
    if (status >= 500) console.error(err);
    res.status(status).json({ message });
  });

  return app;
}
