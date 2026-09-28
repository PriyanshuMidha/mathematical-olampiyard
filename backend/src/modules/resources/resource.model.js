import mongoose from "mongoose";

export const RESOURCE_TYPES = ["Syllabus", "Sample Paper", "Previous Paper", "Formula Sheet", "Answer Key", "Guide"];

const resourceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    type: { type: String, enum: RESOURCE_TYPES, required: true },
    level: { type: String, required: true, maxlength: 60 },
    description: { type: String, default: "", maxlength: 5000 },
    fileUrl: { type: String, default: "", maxlength: 2000 },
    externalLink: { type: String, default: "", maxlength: 2000 },
    status: { type: String, enum: ["draft", "published"], default: "published" }
  },
  { timestamps: true }
);

resourceSchema.index({ status: 1, createdAt: -1 });
resourceSchema.index({ level: 1, status: 1, createdAt: -1 });
resourceSchema.index({ createdAt: -1 });

export default mongoose.model("Resource", resourceSchema);
