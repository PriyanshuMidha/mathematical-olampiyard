import "dotenv/config";

// Single place that reads process.env. Everything else imports `config`.
const num = (value, fallback) => (value === undefined || value === "" ? fallback : Number(value));
const bool = (value, fallback) => (value === undefined || value === "" ? fallback : ["1", "true", "yes"].includes(String(value).toLowerCase()));
const list = (value, fallback) => String(value || fallback).split(",").map((s) => s.trim()).filter(Boolean);

const env = process.env.NODE_ENV || "development";
const isProd = env === "production";
const port = num(process.env.PORT, 5001);
const clientUrls = list(process.env.CLIENT_URL, "http://localhost:5173");

function trustProxy(value) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  return Number.isNaN(Number(value)) ? value : Number(value);
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export const config = Object.freeze({
  env,
  isProd,
  port,
  apiUrl: (process.env.API_URL || `http://localhost:${port}`).replace(/\/$/, ""),
  clientUrls,
  clientUrl: clientUrls[0].replace(/\/$/, ""),
  // Set to the number of proxies in front of the app (e.g. 1 behind a load balancer) so req.ip is the real client.
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  slowRequestMs: num(process.env.SLOW_REQUEST_MS, 1000),
  apiRateLimitPerMin: num(process.env.API_RATE_LIMIT_PER_MIN, 3000),
  // "memory" = per instance, no DB cost; "mongo" = one shared limit across all instances (+1 DB write per request).
  apiRateLimitStore: process.env.API_RATE_LIMIT_STORE === "mongo" ? "mongo" : "memory",

  jwt: {
    secret: process.env.JWT_SECRET || "",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    issuer: "mathematical-olympiad-cms"
  },

  // Admin session lives in an httpOnly cookie (not readable by page JavaScript).
  // Frontend and API on different sites in production -> COOKIE_SAMESITE=none (requires HTTPS).
  cookie: {
    name: process.env.COOKIE_NAME || "olympiad_admin",
    sameSite: (process.env.COOKIE_SAMESITE || "lax").toLowerCase(),
    secure: bool(process.env.COOKIE_SECURE, isProd),
    domain: process.env.COOKIE_DOMAIN || undefined
  },

  mongo: {
    uri: process.env.MONGODB_URI || "",
    serverSelectionTimeoutMS: num(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 8000),
    connectTimeoutMS: num(process.env.MONGO_CONNECT_TIMEOUT_MS, 8000),
    socketTimeoutMS: num(process.env.MONGO_SOCKET_TIMEOUT_MS, 30000),
    maxPoolSize: num(process.env.MONGO_MAX_POOL_SIZE, 20),
    // Keeps connections open so requests never wait on a fresh TLS + auth handshake (~500ms on Atlas).
    minPoolSize: num(process.env.MONGO_MIN_POOL_SIZE, 4),
    // Index builds on boot are fine in dev; in production run `npm run db:indexes` during deploy instead.
    autoIndex: bool(process.env.MONGO_AUTO_INDEX, !isProd)
  },

  cache: {
    homeTtlMs: num(process.env.HOME_CACHE_MS, 60_000),
    listTtlMs: num(process.env.LIST_CACHE_MS, 30_000),
    dashboardTtlMs: num(process.env.DASHBOARD_CACHE_MS, 10_000),
    maxEntries: num(process.env.CACHE_MAX_ENTRIES, 500),
    // How often each instance checks MongoDB for content changes made on other instances. 0 disables.
    syncMs: num(process.env.CACHE_SYNC_MS, 2000)
  },

  uploads: {
    maxMb: num(process.env.MAX_UPLOAD_MB, 50),
    // Local-disk upload folder (default backend/uploads).
    dir: process.env.UPLOAD_DIR || ""
  },

  r2: {
    accountId: process.env.R2_ACCOUNT_ID || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET || "",
    publicUrl: (process.env.R2_PUBLIC_URL || "").replace(/\/$/, ""),
    // Optional: custom S3 endpoint (tests / MinIO). Normally derived from R2_ACCOUNT_ID.
    endpoint: process.env.R2_ENDPOINT || "",
    maxUploadGb: num(process.env.MAX_R2_UPLOAD_GB, 9.5),
    // Total bucket cap (R2 free tier is 10 GB). Uploads that would pass it are refused.
    storageLimitGb: num(process.env.R2_STORAGE_LIMIT_GB, 9.5),
    partSizeBytes: num(process.env.R2_PART_SIZE_BYTES, 64 * 1024 * 1024)
  },

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.EMAIL_FROM || "Mathematical Olympiad <no-reply@localhost>",
    // Optional: where replies go (e.g. your school/contact inbox). Empty = replies go to EMAIL_FROM.
    replyTo: process.env.EMAIL_REPLY_TO || ""
  },

  // Scheduled background jobs (run by one instance at a time, coordinated through MongoDB).
  jobs: {
    enabled: bool(process.env.JOBS_ENABLED, true),
    storageReconcileMs: num(process.env.STORAGE_RECONCILE_MS, 60 * 60_000),
    orphanCleanupMs: num(process.env.ORPHAN_CLEANUP_MS, 24 * 60 * 60_000),
    orphanGraceHours: num(process.env.ORPHAN_GRACE_HOURS, 24)
  },

  notifications: {
    pollMs: num(process.env.NOTIFY_POLL_MS, 10_000),
    batchSize: num(process.env.NOTIFY_BATCH_SIZE, 100),
    concurrency: num(process.env.NOTIFY_CONCURRENCY, 5),
    lockMs: num(process.env.NOTIFY_LOCK_MS, 5 * 60_000),
    // Max emails per UTC day across all servers (free plans: Brevo 300, Mailjet 200, SMTP2GO 200). 0 = no limit.
    dailyLimit: num(process.env.NOTIFY_DAILY_LIMIT, 0),
    // Sign-up confirmation emails get their own small share so fake sign-ups can never use up the
    // quota that news emails need (default: 20% of NOTIFY_DAILY_LIMIT, or 500/day when unlimited).
    confirmDailyLimit: num(
      process.env.NOTIFY_CONFIRM_DAILY_LIMIT,
      num(process.env.NOTIFY_DAILY_LIMIT, 0) ? Math.max(1, Math.floor(num(process.env.NOTIFY_DAILY_LIMIT, 0) * 0.2)) : 500
    )
  },

  // Used only by `npm run seed`. No default password on purpose.
  admin: {
    email: process.env.ADMIN_EMAIL || "",
    password: process.env.ADMIN_PASSWORD || ""
  }
});

// Fails fast on misconfiguration instead of breaking at the first request.
export function assertConfig() {
  const errors = [];
  if (!config.mongo.uri) errors.push("MONGODB_URI is required");
  if (!config.jwt.secret) errors.push("JWT_SECRET is required");
  else if (config.jwt.secret.length < 32) {
    const message = "JWT_SECRET should be at least 32 random characters (e.g. `openssl rand -hex 32`)";
    if (config.isProd) errors.push(message);
    else console.warn(`Warning: ${message}`);
  }
  if (!["lax", "strict", "none"].includes(config.cookie.sameSite)) errors.push("COOKIE_SAMESITE must be lax, strict or none");
  if (config.cookie.sameSite === "none" && !config.cookie.secure) errors.push("COOKIE_SAMESITE=none requires COOKIE_SECURE=true (HTTPS)");
  if (
    config.isProd &&
    config.cookie.sameSite !== "none" &&
    config.clientUrls.some((clientUrl) => originOf(clientUrl) && originOf(clientUrl) !== originOf(config.apiUrl))
  ) {
    errors.push("COOKIE_SAMESITE must be none when CLIENT_URL and API_URL are different origins");
  }
  if (/change-this|example|secret-at-least/i.test(config.jwt.secret)) {
    const message = "JWT_SECRET is still the example value; generate one with `openssl rand -hex 32`";
    if (config.isProd) errors.push(message);
    else console.warn(`Warning: ${message}`);
  }
  if (config.trustProxy === true) {
    const message = "TRUST_PROXY=true lets any client fake its IP (bypassing rate limits); use the number of proxies, e.g. TRUST_PROXY=1";
    if (config.isProd) errors.push(message);
    else console.warn(`Warning: ${message}`);
  }
  if (config.isProd && !config.trustProxy) {
    console.warn("Warning: TRUST_PROXY is not set. If the API runs behind a load balancer/proxy, set TRUST_PROXY=1 or all visitors share one rate limit.");
  }
  if (config.isProd && config.apiUrl.includes("localhost")) {
    console.warn("Warning: API_URL points to localhost in production; upload and unsubscribe links will be wrong.");
  }
  if (errors.length) {
    throw new Error(`Invalid configuration:\n- ${errors.join("\n- ")}\nCopy backend/.env.example to backend/.env and fill it in.`);
  }
}
