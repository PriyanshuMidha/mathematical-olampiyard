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

newsSchema.index({ title: "text", shortDescription: "text", fullDescription: "text" });
newsSchema.index({ status: 1, publishedAt: -1, createdAt: -1 });
newsSchema.index({ status: 1, isCurrent: 1, publishedAt: -1 });
newsSchema.index({ status: 1, showOnHome: 1, publishedAt: -1 });
newsSchema.index({ status: 1, level: 1, publishedAt: -1 });
newsSchema.index({ status: 1, category: 1, publishedAt: -1 });
newsSchema.index({ createdAt: -1 });

export default mongoose.model("News", newsSchema);
