import { config } from "../../config/env.js";
import { cached } from "../../core/cache.js";
import { contentChanged } from "../../core/contentChanged.js";
import { badRequest, notFound } from "../../core/errors.js";
import { events } from "../../core/events.js";
import { assertSafeUrls, pick, queryString, toBool } from "../../core/validate.js";
import { enqueueNewsEmail } from "../notifications/notifications.service.js";
import { assertTaxonomy, registerTaxonomyUsage } from "../taxonomy/taxonomy.service.js";
import { registerFileReferences } from "../uploads/references.js";
import { fileUrl, removeStoredFile } from "../uploads/storage.js";
import { makeSlug } from "./slug.js";
import News from "./news.model.js";

const FIELDS = ["title", "slug", "shortDescription", "fullDescription", "imageUrl", "attachmentUrl", "externalLink", "level", "category", "status", "publishedAt"];
const FLAGS = ["isCurrent", "showOnHome", "sendEmailNotification"];
const URL_FIELDS = ["imageUrl", "attachmentUrl", "externalLink"];
export const CARD_FIELDS = "title slug shortDescription imageUrl level category publishedAt createdAt isCurrent showOnHome";
const CACHE = "news:";
const published = { status: "published" };

registerTaxonomyUsage(async (type, name) => Boolean(await News.exists({ [type === "level" ? "level" : "category"]: name })));
registerFileReferences(async () => [...(await News.distinct("imageUrl")), ...(await News.distinct("attachmentUrl"))]);

// Keeps emailSentAt in sync without the notifications module importing this one.
events.on("notification:sent", async ({ newsId, sentAt }) => {
  await News.updateOne({ _id: newsId }, { emailSentAt: sentAt });
});

function changed() {
  contentChanged("news", [CACHE]);
}

async function uniqueSlug(value, idToIgnore) {
  const base = makeSlug(String(value)) || "news";
  let slug = base;
  for (let index = 2; await News.exists({ slug, ...(idToIgnore ? { _id: { $ne: idToIgnore } } : {}) }); index += 1) {
    slug = `${base}-${index}`;
  }
  return slug;
}

function applyFiles(data, files) {
  if (files?.image?.[0]) data.imageUrl = fileUrl(files.image[0]);
  if (files?.attachment?.[0]) data.attachmentUrl = fileUrl(files.attachment[0]);
}

async function validate(data) {
  assertSafeUrls(data, URL_FIELDS);
  await assertTaxonomy("level", data.level);
  await assertTaxonomy("category", data.category);
}

function queueEmail(news) {
  if (!news.sendEmailNotification || news.status !== "published" || news.emailSentAt) return { skipped: true };
  return enqueueNewsEmail({
    newsId: news._id,
    title: news.title,
    slug: news.slug,
    shortDescription: news.shortDescription,
    level: news.level,
    category: news.category
  });
}

// ---------- public ----------

export function listPublished(query) {
  const level = queryString(query.level, 60);
  const category = queryString(query.category, 60);
  const q = queryString(query.q, 100);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 24, 1), 100);
  const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), 1000);

  const filter = { ...published };
  if (level) filter.level = level;
  if (category) filter.category = category;
  if (query.current === "true") filter.isCurrent = true;
  if (q) filter.$text = { $search: q };

  const run = () =>
    News.find(filter)
      .select(CARD_FIELDS)
      .sort({ publishedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

  // Free-text searches are not cached (unbounded key space); filter combinations are.
  if (q) return run();
  return cached(`${CACHE}list:${level}|${category}|${filter.isCurrent || ""}|${page}|${limit}`, config.cache.listTtlMs, run);
}

export function getPublishedBySlug(slug) {
  const safeSlug = String(slug).toLowerCase().slice(0, 220);
  return cached(`${CACHE}detail:${safeSlug}`, config.cache.listTtlMs, async () => {
    const news = await News.findOne({ slug: safeSlug, ...published }).lean();
    if (!news) return null;
    const related = await News.find({ _id: { $ne: news._id }, level: news.level, ...published })
      .select(CARD_FIELDS)
      .sort({ publishedAt: -1 })
      .limit(3)
      .lean();
    return { news, related };
  });
}

export function homeSections() {
  return Promise.all([
    News.find({ ...published, isCurrent: true }).select(CARD_FIELDS).sort({ publishedAt: -1 }).limit(4).lean(),
    News.find({ ...published, showOnHome: true }).select(CARD_FIELDS).sort({ publishedAt: -1 }).limit(6).lean()
  ]).then(([currentNews, latestNews]) => ({ currentNews, latestNews }));
}

export async function stats() {
  const [newsCount, draftCount, currentCount, recentNews] = await Promise.all([
    News.estimatedDocumentCount(),
    News.countDocuments({ status: "draft" }),
    News.countDocuments({ status: "published", isCurrent: true }),
    News.find().select("title slug status level category createdAt publishedAt").sort({ createdAt: -1 }).limit(5).lean()
  ]);
  return { newsCount, draftCount, currentCount, recentNews };
}

// ---------- admin ----------

export function listAll(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 500, 1), 1000);
  return News.find().select("-fullDescription").sort({ createdAt: -1 }).limit(limit).lean();
}

export async function getById(id) {
  const news = await News.findById(id).lean();
  if (!news) throw notFound("News");
  return news;
}

export async function create(body, files) {
  const data = pick(body, FIELDS);
  for (const flag of FLAGS) data[flag] = toBool(body[flag]);
  applyFiles(data, files);
  if (!data.title || typeof data.title !== "string") throw badRequest("Title is required");
  await validate(data);
  data.publishedAt = data.status === "published" ? data.publishedAt || new Date() : undefined;

  // Two admins publishing the same title at once can both pick the same free slug; retry on the unique index.
  let news;
  for (let attempt = 0; !news; attempt += 1) {
    data.slug = await uniqueSlug(data.slug || data.title);
    try {
      news = await News.create(data);
    } catch (error) {
      if (error?.code !== 11000 || attempt >= 2) throw error;
    }
  }

  changed();
  const emailResult = await queueEmail(news);
  return { news, emailResult };
}

export async function update(id, body, files) {
  const existing = await News.findById(id);
  if (!existing) throw notFound("News");

  const next = pick(body, FIELDS);
  // Only touch flags that were actually sent, so partial updates don't reset them.
  for (const flag of FLAGS) if (body[flag] !== undefined) next[flag] = toBool(body[flag]);
  applyFiles(next, files);
  await validate(next);

  // Slug stays stable when the title changes (links may already be shared/emailed); change it only on request.
  if (next.slug !== undefined) {
    next.slug = next.slug && next.slug !== existing.slug ? await uniqueSlug(next.slug, existing._id) : existing.slug;
  }
  if (!next.publishedAt) delete next.publishedAt;
  if ((next.status || existing.status) === "published" && !existing.publishedAt && !next.publishedAt) {
    next.publishedAt = new Date();
  }

  const replaced = URL_FIELDS.filter((f) => next[f] !== undefined && next[f] !== existing[f]).map((f) => existing[f]);
  existing.set(next);
  await existing.save();
  await Promise.all(replaced.map(removeStoredFile));

  changed();
  const emailResult = await queueEmail(existing);
  return { news: existing, emailResult };
}

export async function remove(id) {
  const news = await News.findByIdAndDelete(id);
  if (!news) throw notFound("News");
  await Promise.all([news.imageUrl, news.attachmentUrl].map(removeStoredFile));
  changed();
}
