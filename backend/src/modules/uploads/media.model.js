import mongoose from "mongoose";

const mediaSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true, maxlength: 255 },
    filename: { type: String, required: true },
    url: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true }
  },
  { timestamps: true }
);

export default mongoose.model("Media", mediaSchema);
