import mongoose from "mongoose";

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, default: "Administrator", maxlength: 100 },
    // Login identifier: an email address or a plain username such as "admin".
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true },
    // Bumped on password change/reset: every session issued before that stops working.
    tokenVersion: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export default mongoose.model("Admin", adminSchema);
