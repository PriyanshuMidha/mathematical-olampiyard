import mongoose from "mongoose";

const url = { type: String, default: "", maxlength: 2000 };

const newsSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 220 },
    shortDescription: { type: String, required: true, trim: true, maxlength: 1000 },
    fullDescription: { type: String, required: true, maxlength: 100_000 },
    imageUrl: url,
    attachmentUrl: url,
    externalLink: url,
    // Allowed values come from the Taxonomy collection (validated in news.service).
    level: { type: String, required: true, trim: true, maxlength: 60 },
    category: { type: String, default: "General", trim: true, maxlength: 60 },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    isCurrent: { type: Boolean, default: false },
    showOnHome: { type: Boolean, default: false },
    sendEmailNotification: { type: Boolean, default: false },
    publishedAt: { type: Date },
    // Set by the notifications module (via the "notification:sent" event) once the email went out.
    emailSentAt: { type: Date }
  },
  { timestamps: true }
);

// Every index costs disk + RAM and slows each save, so only indexes that a real query uses are kept.
// Search covers title + summary (not the full article body, which can be 100 KB and would make the
// text index many times bigger than the data itself). Title matches rank higher.
newsSchema.index({ title: "text", shortDescription: "text" }, { name: "news_search", weights: { title: 5, shortDescription: 1 } });
// Public lists / drafts count / cursor for "latest".
newsSchema.index({ status: 1, publishedAt: -1, createdAt: -1 });
// Home "current" and "on home" sections: partial indexes only contain the few matching documents.
newsSchema.index({ isCurrent: 1, publishedAt: -1 }, { name: "home_current", partialFilterExpression: { status: "published", isCurrent: true } });
newsSchema.index({ showOnHome: 1, publishedAt: -1 }, { name: "home_latest", partialFilterExpression: { status: "published", showOnHome: true } });
// Level / category filters and "related news".
// (createdAt included because public lists sort by publishedAt, then createdAt.)
newsSchema.index({ status: 1, level: 1, publishedAt: -1, createdAt: -1 });
newsSchema.index({ status: 1, category: 1, publishedAt: -1, createdAt: -1 });
// Admin list + dashboard "recent".
newsSchema.index({ createdAt: -1 });

export default mongoose.model("News", newsSchema);
