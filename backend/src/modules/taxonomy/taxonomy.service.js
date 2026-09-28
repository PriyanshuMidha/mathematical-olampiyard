import { cached, invalidate } from "../../core/cache.js";
import { contentChanged } from "../../core/contentChanged.js";
import { badRequest, conflict, notFound } from "../../core/errors.js";
import { pick } from "../../core/validate.js";
import Taxonomy from "./taxonomy.model.js";

const CACHE_KEY = "taxonomy:all";

// Other modules register how they use levels/categories, so this module never imports them.
// checker(type, name) -> Promise<boolean>  (true = still in use)
const usageCheckers = [];
export function registerTaxonomyUsage(checker) {
  usageCheckers.push(checker);
}

export function listTaxonomies() {
  return cached(CACHE_KEY, 5 * 60_000, () => Taxonomy.find().sort({ type: 1, createdAt: 1 }).select("type name").lean());
}

export async function listTaxonomiesAdmin() {
  return Taxonomy.find().sort({ type: 1, name: 1 }).lean();
}

// Validates a level/category value. If no entries of that type exist yet, any value is allowed.
export async function assertTaxonomy(type, value) {
  if (value === undefined) return;
  // Reject objects like {"$ne": ""} so they can never act as query operators.
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${type} must be text`);
  const names = (await listTaxonomies()).filter((t) => t.type === type).map((t) => t.name);
  if (!names.length || names.includes(value)) return;
  // Cache may be stale if another instance just added the value; confirm with the DB before rejecting.
  if (await Taxonomy.exists({ type, name: value })) {
    invalidate(CACHE_KEY);
    return;
  }
  throw badRequest(`Unknown ${type} "${value}". Add it under Categories first.`);
}

export async function createTaxonomy(body) {
  const data = pick(body, ["type", "name", "description"]);
  if (typeof data.name === "string") data.name = data.name.trim();
  if (!data.name) throw badRequest("Name is required");
  const item = await Taxonomy.create(data);
  contentChanged("taxonomy", [CACHE_KEY]);
  return item;
}

export async function deleteTaxonomy(id) {
  const item = await Taxonomy.findById(id);
  if (!item) throw notFound("Taxonomy");

  const usage = await Promise.all(usageCheckers.map((check) => check(item.type, item.name)));
  if (usage.some(Boolean)) throw conflict(`"${item.name}" is still used by existing content`);

  await item.deleteOne();
  contentChanged("taxonomy", [CACHE_KEY]);
}
