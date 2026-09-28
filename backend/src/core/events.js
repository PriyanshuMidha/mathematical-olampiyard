import { EventEmitter } from "events";

// In-process event bus so feature modules can react to each other without importing each other.
//   "content:changed"  { module }   -> caches that aggregate several modules (home, dashboard) invalidate
//   "news:email-queued" { id }      -> notification worker wakes up immediately instead of waiting for its poll
export const events = new EventEmitter();
events.setMaxListeners(50);

export function emitSafe(event, payload) {
  for (const listener of events.listeners(event)) {
    Promise.resolve()
      .then(() => listener(payload))
      .catch((error) => console.error(`Listener for "${event}" failed:`, error));
  }
}
