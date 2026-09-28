import mongoose from "mongoose";

const taxonomySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["level", "category"], required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: "", maxlength: 500 }
  },
  { timestamps: true }
);

taxonomySchema.index({ type: 1, name: 1 }, { unique: true });
taxonomySchema.index({ type: 1, createdAt: 1 });

export default mongoose.model("Taxonomy", taxonomySchema);
