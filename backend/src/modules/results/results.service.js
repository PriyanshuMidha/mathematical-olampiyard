import { config } from "../../config/env.js";
import { cached } from "../../core/cache.js";
import { contentChanged } from "../../core/contentChanged.js";
import { notFound } from "../../core/errors.js";
import { assertSafeUrls, pick } from "../../core/validate.js";
import { assertTaxonomy, registerTaxonomyUsage } from "../taxonomy/taxonomy.service.js";
import { registerFileReferences } from "../uploads/references.js";
import { fileUrl, removeStoredFile } from "../uploads/storage.js";
import Result from "./result.model.js";

const FIELDS = ["title", "level", "year", "session", "description", "fileUrl", "externalLink", "status"];
const URL_FIELDS = ["fileUrl", "externalLink"];
const CACHE = "results:";
const published = { status: "published" };

registerTaxonomyUsage(async (type, name) => type === "level" && Boolean(await Result.exists({ level: name })));
registerFileReferences(async () => Result.distinct("fileUrl"));

function changed() {
  contentChanged("results", [CACHE]);
}

async function prepare(body, file) {
  const data = pick(body, FIELDS);
  if (file) data.fileUrl = fileUrl(file);
  assertSafeUrls(data, URL_FIELDS);
  await assertTaxonomy("level", data.level);
  return data;
}

export function listPublished() {
  return cached(`${CACHE}public`, config.cache.listTtlMs, () =>
    Result.find(published).sort({ year: -1, publishedAt: -1 }).limit(500).lean()
  );
}

export function homeSection() {
  return Result.find(published).select("title level year session publishedAt createdAt").sort({ publishedAt: -1 }).limit(3).lean();
}

export function count() {
  return Result.estimatedDocumentCount();
}

export function listAll(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 500, 1), 1000);
  return Result.find().sort({ createdAt: -1 }).limit(limit).lean();
}

export async function create(body, file) {
  const data = await prepare(body, file);
  if (data.status === "published") data.publishedAt = new Date();
  const result = await Result.create(data);
  changed();
  return result;
}

export async function update(id, body, file) {
  const existing = await Result.findById(id);
  if (!existing) throw notFound("Result");
  const next = await prepare(body, file);
  if ((next.status || existing.status) === "published" && !existing.publishedAt) next.publishedAt = new Date();

  const oldFile = next.fileUrl !== undefined && next.fileUrl !== existing.fileUrl ? existing.fileUrl : null;
  existing.set(next);
  await existing.save();
  if (oldFile) await removeStoredFile(oldFile);
  changed();
  return existing;
}

export async function remove(id) {
  const result = await Result.findByIdAndDelete(id);
  if (!result) throw notFound("Result");
  await removeStoredFile(result.fileUrl);
  changed();
}
