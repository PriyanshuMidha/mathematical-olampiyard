import mongoose from "mongoose";

// One job per news item (unique newsId), so the same news can never be emailed twice,
// even if several admins/instances publish it at the same moment.
const emailJobSchema = new mongoose.Schema(
  {
    newsId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    // Snapshot of what goes in the email, so this module never needs to read the News collection.
    news: {
      title: String,
      slug: String,
      shortDescription: String,
      level: String,
      category: String
    },
    status: { type: String, enum: ["queued", "sending", "sent", "failed", "skipped"], default: "queued", index: true },
    cursor: { type: mongoose.Schema.Types.ObjectId }, // last recipient processed (resume point after a crash)
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    lastError: { type: String, maxlength: 1000 },
    finishedAt: { type: Date }
  },
  { timestamps: true }
);

emailJobSchema.index({ status: 1, lockedUntil: 1, createdAt: 1 });

export default mongoose.model("EmailJob", emailJobSchema);
