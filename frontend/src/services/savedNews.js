const LEGACY_KEY = "savedNews";
const KEY = "savedItems";

function itemKey(item, type = item.type || "news") {
  return `${type}:${item.slug || item._id || item.title}`;
}

function readRaw(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function read() {
  const current = readRaw(KEY);
  const legacy = readRaw(LEGACY_KEY).map((item) => ({ ...item, type: item.type || "news", key: item.key || itemKey(item, "news") }));
  const merged = [...current, ...legacy];
  const seen = new Set();
  return merged.filter((item) => {
    const key = item.key || itemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Returns false when the browser blocks or has no room in storage (private mode, storage full).
function writeItems(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent("saved-news-changed"));
  return true;
}

// Keeps Save buttons in sync when items are saved in another tab of the same browser.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === LEGACY_KEY) window.dispatchEvent(new CustomEvent("saved-news-changed"));
  });
}

function snapshot(item, type = "news") {
  const key = itemKey(item, type);
  return {
    key,
    type,
    _id: item._id,
    title: item.title,
    slug: item.slug,
    shortDescription: item.shortDescription || item.description || "",
    imageUrl: item.imageUrl,
    level: item.level,
    category: item.category || item.type,
    year: item.year,
    session: item.session,
    fileUrl: item.fileUrl,
    attachmentUrl: item.attachmentUrl,
    externalLink: item.externalLink,
    publishedAt: item.publishedAt,
    savedAt: new Date().toISOString()
  };
}

export function savedNews() {
  return read().sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
}

export function isSaved(item, type = "news") {
  const key = typeof item === "string" ? `news:${item}` : itemKey(item, type);
  return read().some((saved) => saved.key === key || saved.slug === item);
}

export function saveNews(item, type = "news") {
  const next = snapshot(item, type);
  const current = read().filter((saved) => saved.key !== next.key);
  return writeItems([next, ...current].slice(0, 300));
}

export function removeSavedNews(itemOrKey) {
  const key = typeof itemOrKey === "string" && itemOrKey.includes(":") ? itemOrKey : `news:${itemOrKey}`;
  return writeItems(read().filter((item) => item.key !== key && item.slug !== itemOrKey));
}

// Returns { saved, ok }: the state after the attempt, and whether the browser allowed storing it.
export function toggleSavedNews(item, type = "news") {
  const ok = isSaved(item, type) ? removeSavedNews(itemKey(item, type)) : saveNews(item, type);
  return { saved: isSaved(item, type), ok };
}
