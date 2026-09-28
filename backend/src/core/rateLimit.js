import mongoose from "mongoose";
import { tooMany } from "./errors.js";

// Fixed-window rate limiting.
// store "mongo": shared by all app instances (use for security-sensitive limits such as login).
// store "memory": per instance, no DB round trip (use for high-volume, best-effort limits).
const hitSchema = new mongoose.Schema({
  _id: String,
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true }
});
hitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const RateLimitHit = mongoose.model("RateLimitHit", hitSchema);

const memory = new Map();
const MEMORY_MAX_KEYS = 200_000; // hard cap so a flood of distinct IPs can't exhaust memory
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memory) if (entry.expiresAt <= now) memory.delete(key);
}, 60_000).unref();

// Client identity for limits: IPv4 as-is, IPv6 grouped by /64 (one home/office network),
// so rotating addresses inside one IPv6 block doesn't reset the limit.
export function clientKey(req) {
  const ip = String(req.ip || "").replace(/^::ffff:/, "");
  if (!ip.includes(":")) return ip;
  const parts = ip.split("::");
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts[1] ? parts[1].split(":") : [];
  const full = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail];
  return `${full.slice(0, 4).join(":")}::/64`;
}

export function windowEnd(windowMs) {
  return (Math.floor(Date.now() / windowMs) + 1) * windowMs;
}

// Returns the hit count for `key` in the current window (including this hit).
export async function hit(key, { windowMs, store = "mongo" }) {
  const bucket = Math.floor(Date.now() / windowMs);
  const expiresAt = (bucket + 1) * windowMs;
  const id = `${key}:${bucket}`;

  if (store === "memory") {
    let entry = memory.get(id);
    if (!entry) {
      if (memory.size >= MEMORY_MAX_KEYS) memory.delete(memory.keys().next().value);
      entry = { count: 0, expiresAt };
      memory.set(id, entry);
    }
    entry.count += 1;
    return entry.count;
  }

  try {
    const doc = await RateLimitHit.findOneAndUpdate(
      { _id: id },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(expiresAt) } },
      { upsert: true, new: true, lean: true }
    );
    return doc.count;
  } catch (error) {
    // Fail open: a rate-limit storage problem must not take the site down.
    console.error("Rate limit store error:", error.message);
    return 0;
  }
}

// Current count for `key` in this window, without adding a hit.
export async function peek(key, { windowMs, store = "mongo" }) {
  const id = `${key}:${Math.floor(Date.now() / windowMs)}`;
  if (store === "memory") return memory.get(id)?.count || 0;
  try {
    return (await RateLimitHit.findById(id).lean())?.count || 0;
  } catch (error) {
    console.error("Rate limit store error:", error.message);
    return 0;
  }
}

export async function resetHits(key, { windowMs }) {
  const bucket = Math.floor(Date.now() / windowMs);
  await RateLimitHit.deleteOne({ _id: `${key}:${bucket}` }).catch(() => {});
}

export function rateLimit({ name, windowMs, max, store = "mongo", key = clientKey, message }) {
  return async (req, res, next) => {
    try {
      const count = await hit(`${name}:${key(req)}`, { windowMs, store });
      const resetSeconds = Math.max(1, Math.ceil((windowEnd(windowMs) - Date.now()) / 1000));
      // Standard rate-limit headers so clients can back off politely.
      res.set("RateLimit-Limit", String(max));
      res.set("RateLimit-Remaining", String(Math.max(0, max - count)));
      res.set("RateLimit-Reset", String(resetSeconds));
      if (count > max) {
        res.set("Retry-After", String(resetSeconds));
        return next(tooMany(message));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
