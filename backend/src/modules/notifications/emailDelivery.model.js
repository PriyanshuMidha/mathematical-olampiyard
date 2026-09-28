import mongoose from "mongoose";

// One row per (job, recipient). Inserted *before* sending, so a job resumed after a crash
// skips everyone already handled -> a user can never get the same news email twice.
const deliverySchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, required: true },
  subscriberId: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: Date.now }
});

deliverySchema.index({ jobId: 1, subscriberId: 1 }, { unique: true });
// Old delivery rows are only needed while a job can still be retried.
deliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export default mongoose.model("EmailDelivery", deliverySchema);
