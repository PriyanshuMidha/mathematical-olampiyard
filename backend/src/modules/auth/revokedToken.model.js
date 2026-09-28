import mongoose from "mongoose";

// Sessions ended with "Logout" before they expired. Rows delete themselves when the token would expire anyway.
const revokedSchema = new mongoose.Schema({ _id: String, expiresAt: { type: Date, required: true } }, { versionKey: false });
revokedSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("RevokedToken", revokedSchema);
