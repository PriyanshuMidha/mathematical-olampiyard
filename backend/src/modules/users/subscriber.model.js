import crypto from "crypto";
import mongoose from "mongoose";

export const PREFERENCES = ["All updates", "Results only", "Exam dates", "Resources"];

// A "user" in the admin UI: someone who receives news email notifications.
const subscriberSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "", maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    preference: { type: String, enum: PREFERENCES, default: "All updates" },
    active: { type: Boolean, default: true },
    // Public sign-ups start inactive and become active only after clicking the confirmation link.
    source: { type: String, enum: ["admin", "public"], default: "admin" },
    confirmToken: { type: String, index: { unique: true, sparse: true } },
    confirmSentAt: { type: Date },
    confirmedAt: { type: Date },
    unsubscribeToken: { type: String, default: () => crypto.randomBytes(24).toString("hex"), index: { unique: true, sparse: true } }
  },
  { timestamps: true }
);

// Recipient batches are read in _id order per preference.
subscriberSchema.index({ active: 1, preference: 1, _id: 1 });
subscriberSchema.index({ createdAt: -1 });

export default mongoose.model("Subscriber", subscriberSchema);
