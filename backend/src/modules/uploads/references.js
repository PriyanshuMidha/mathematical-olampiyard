import path from "path";

// Modules that store file URLs register a provider returning every URL they currently use,
// so the orphan-cleanup job never deletes a file that a record still points to.
const providers = [];

export function registerFileReferences(provider) {
  providers.push(provider);
}

// Stored file names are unique (timestamp + random), so the last path segment identifies a file
// no matter which host/URL form a record saved (local API_URL, old host, or R2 public URL).
export function fileId(urlOrKey) {
  try {
    return decodeURIComponent(path.posix.basename(String(urlOrKey).split(/[?#]/)[0]));
  } catch {
    return path.posix.basename(String(urlOrKey));
  }
}

export async function referencedFileIds() {
  const lists = await Promise.all(providers.map((provider) => provider()));
  return new Set(lists.flat().filter(Boolean).map(fileId));
}
