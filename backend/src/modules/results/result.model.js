import mongoose from "mongoose";

const resultSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    level: { type: String, required: true, maxlength: 60 },
    year: { type: Number, required: true, min: 1900, max: 2100 },
    session: { type: String, default: "", maxlength: 100 },
    description: { type: String, default: "", maxlength: 5000 },
    fileUrl: { type: String, default: "", maxlength: 2000 },
    externalLink: { type: String, default: "", maxlength: 2000 },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    publishedAt: { type: Date }
  },
  { timestamps: true }
);

resultSchema.index({ status: 1, publishedAt: -1 });
resultSchema.index({ status: 1, year: -1, publishedAt: -1 });
resultSchema.index({ level: 1 });
resultSchema.index({ createdAt: -1 });

export default mongoose.model("Result", resultSchema);
