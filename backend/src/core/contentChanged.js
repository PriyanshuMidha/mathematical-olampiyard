import mongoose from "mongoose";
import { config } from "../config/env.js";
import { invalidate } from "./cache.js";
import { emitSafe } from "./events.js";

// Cross-instance cache invalidation without Redis.
// A write calls contentChanged(module, prefixes): the local cache is cleared at once, "content:changed"
// is emitted locally, and a small version document for that module is bumped in MongoDB.
// Every instance polls those version documents (one tiny query every CACHE_SYNC_MS) and, when a
// version moved, clears the same prefixes and emits the same event, so all instances converge in ~2s.
const versionSchema = new mongoose.Schema({ _id: String, v: { type: Number, default: 0 }, prefixes: [String] }, { versionKey: false });
const CacheVersion = mongoose.model("CacheVersion", versionSchema);

const seen = new Map();
let timer;
let initialized = false;

function applyLocally(module, prefixes) {
  prefixes.forEach((prefix) => invalidate(prefix));
  emitSafe("content:changed", { module });
}

export function contentChanged(module, prefixes = []) {
  applyLocally(module, prefixes);
  if (!config.cache.syncMs) return;
  CacheVersion.findOneAndUpdate({ _id: module }, { $inc: { v: 1 }, $set: { prefixes } }, { upsert: true, new: true, lean: true })
    .then((doc) => seen.set(module, doc.v)) // our own bump: don't re-apply it on the next poll
    .catch((error) => console.error("Cache version bump failed:", error.message));
}

async function poll() {
  try {
    const docs = await CacheVersion.find().lean();
    for (const doc of docs) {
      const last = seen.get(doc._id);
      seen.set(doc._id, doc.v);
      // After the first poll, a document we've never seen means another instance just made the first change.
      if (initialized && last !== doc.v) applyLocally(doc._id, doc.prefixes || []);
    }
    initialized = true;
  } catch (error) {
    console.error("Cache sync poll failed:", error.message);
  }
}

export async function startCacheSync() {
  if (!config.cache.syncMs) return;
  await poll(); // records current versions without invalidating anything
  timer = setInterval(poll, config.cache.syncMs);
  timer.unref();
}

export function stopCacheSync() {
  clearInterval(timer);
}
