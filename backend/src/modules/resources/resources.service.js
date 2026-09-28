import { config } from "../../config/env.js";
import { cached } from "../../core/cache.js";
import { contentChanged } from "../../core/contentChanged.js";
import { notFound } from "../../core/errors.js";
import { assertSafeUrls, pick } from "../../core/validate.js";
import { assertTaxonomy, registerTaxonomyUsage } from "../taxonomy/taxonomy.service.js";
import { registerFileReferences } from "../uploads/references.js";
import { fileUrl, removeStoredFile } from "../uploads/storage.js";
import Resource from "./resource.model.js";

const FIELDS = ["title", "type", "level", "description", "fileUrl", "externalLink", "status"];
const URL_FIELDS = ["fileUrl", "externalLink"];
const CACHE = "resources:";
const published = { status: "published" };

registerTaxonomyUsage(async (type, name) => type === "level" && Boolean(await Resource.exists({ level: name })));
registerFileReferences(async () => Resource.distinct("fileUrl"));

function changed() {
  contentChanged("resources", [CACHE]);
}

async function prepare(body, file) {
  const data = pick(body, FIELDS);
  if (file) data.fileUrl = fileUrl(file);
  assertSafeUrls(data, URL_FIELDS);
  await assertTaxonomy("level", data.level);
  return data;
}

export function listPublished() {
  return cached(`${CACHE}public`, config.cache.listTtlMs, () => Resource.find(published).sort({ createdAt: -1 }).limit(500).lean());
}

export function homeSection() {
  return Resource.find(published).select("title type level fileUrl externalLink createdAt").sort({ createdAt: -1 }).limit(4).lean();
}

export function count() {
  return Resource.estimatedDocumentCount();
}

export function listAll(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 500, 1), 1000);
  return Resource.find().sort({ createdAt: -1 }).limit(limit).lean();
}

export async function create(body, file) {
  const resource = await Resource.create(await prepare(body, file));
  changed();
  return resource;
}

export async function update(id, body, file) {
  const existing = await Resource.findById(id);
  if (!existing) throw notFound("Resource");
  const next = await prepare(body, file);

  const oldFile = next.fileUrl !== undefined && next.fileUrl !== existing.fileUrl ? existing.fileUrl : null;
  existing.set(next);
  await existing.save();
  if (oldFile) await removeStoredFile(oldFile);
  changed();
  return existing;
}

export async function remove(id) {
  const resource = await Resource.findByIdAndDelete(id);
  if (!resource) throw notFound("Resource");
  await removeStoredFile(resource.fileUrl);
  changed();
}
