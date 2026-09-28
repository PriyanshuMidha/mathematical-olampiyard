import { config } from "../config/env.js";

// In-process stale-while-revalidate cache with single-flight loading.
// - Fresh hit: returned immediately.
// - Stale hit: returned immediately, refreshed in the background (visitors never wait on the DB).
// - Miss: one loader call per key even if many requests arrive at once (no stampede).
// Each instance has its own cache; with several instances, other instances pick up writes within the TTL.
const store = new Map();
const inflight = new Map();
let generation = 0;

function evictIfFull() {
  while (store.size >= config.cache.maxEntries) store.delete(store.keys().next().value);
}

function load(key, ttlMs, staleMs, loader) {
  if (inflight.has(key)) return inflight.get(key);
  const startedAt = generation;
  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      // Don't store a result that was loaded before an invalidation happened, and never store
      // "not found" (null): otherwise random URLs would fill the cache and push out real entries.
      if (startedAt === generation && value !== null && value !== undefined) {
        evictIfFull();
        const now = Date.now();
        store.set(key, { value, freshUntil: now + ttlMs, staleUntil: now + ttlMs + staleMs });
      }
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export async function cached(key, ttlMs, loader, { staleMs = ttlMs * 10 } = {}) {
  const hit = store.get(key);
  const now = Date.now();
  if (hit) {
    // Least-recently-used eviction: move hot entries to the end so a flood of new keys can't push them out.
    store.delete(key);
    store.set(key, hit);
  }
  if (hit && hit.freshUntil > now) return hit.value;
  if (hit && hit.staleUntil > now) {
    load(key, ttlMs, staleMs, loader).catch((error) => console.error(`Cache refresh failed for ${key}:`, error.message));
    return hit.value;
  }
  return load(key, ttlMs, staleMs, loader);
}

export function invalidate(prefix = "") {
  generation += 1;
  for (const key of store.keys()) {
    if (!prefix || key.startsWith(prefix)) store.delete(key);
  }
}
