const KEY = "savedNews";

function read() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function write(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("saved-news-changed"));
}

function snapshot(item) {
  return {
    _id: item._id,
    title: item.title,
    slug: item.slug,
    shortDescription: item.shortDescription,
    imageUrl: item.imageUrl,
    level: item.level,
    category: item.category,
    publishedAt: item.publishedAt,
    savedAt: new Date().toISOString()
  };
}

export function savedNews() {
  return read().sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
}

export function isSaved(slug) {
  return read().some((item) => item.slug === slug);
}

export function saveNews(item) {
  const current = read().filter((saved) => saved.slug !== item.slug);
  write([snapshot(item), ...current].slice(0, 200));
}

export function removeSavedNews(slug) {
  write(read().filter((item) => item.slug !== slug));
}

export function toggleSavedNews(item) {
  if (isSaved(item.slug)) {
    removeSavedNews(item.slug);
    return false;
  }
  saveNews(item);
  return true;
}
