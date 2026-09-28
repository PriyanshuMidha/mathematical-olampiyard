import mongoose from "mongoose";
import { config } from "../../config/env.js";
import { AppError } from "../../core/errors.js";

// Total-storage cap for the Cloudflare R2 bucket (default 9.5 GB, under the 10 GB free tier).
//
// `StorageUsage.bytes` = bytes in the bucket + bytes reserved by uploads in progress.
// An upload first *reserves* its size with one atomic conditional update, so two admins (or two
// API instances) uploading at the same moment can never push the total past the limit.
// The hourly reconcile job recounts the real bucket and corrects any drift (abandoned uploads, etc.).
export const LIMIT_BYTES = Math.floor(config.r2.storageLimitGb * 1024 ** 3);
const ID = "r2";
const PENDING_TTL_MS = 6 * 60 * 60_000; // reservations of uploads never finished are dropped after this

const usageSchema = new mongoose.Schema(
  { _id: String, bytes: { type: Number, default: 0 }, objects: Number, reconciledAt: Date },
  { versionKey: false }
);
const StorageUsage = mongoose.model("StorageUsage", usageSchema);

const reservationSchema = new mongoose.Schema(
  {
    _id: String, // object key
    bytes: { type: Number, required: true },
    status: { type: String, enum: ["pending", "done"], default: "pending" },
    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);
reservationSchema.index({ status: 1, createdAt: 1 });
const StorageReservation = mongoose.model("StorageReservation", reservationSchema);

function gb(bytes) {
  return (bytes / 1024 ** 3).toFixed(2);
}

async function ensureUsageDoc() {
  await StorageUsage.updateOne({ _id: ID }, { $setOnInsert: { bytes: 0 } }, { upsert: true }).catch((error) => {
    if (error?.code !== 11000) throw error;
  });
}

// Returns true when space was reserved, false when this key is already reserved (the identical file is
// being uploaded by another request right now - nothing extra to count).
export async function reserve(key, bytes) {
  if (await StorageReservation.exists({ _id: key })) return false;
  await ensureUsageDoc();
  const updated = await StorageUsage.findOneAndUpdate(
    { _id: ID, bytes: { $lte: LIMIT_BYTES - bytes } },
    { $inc: { bytes } },
    { new: true, lean: true }
  );
  if (!updated) {
    const current = await StorageUsage.findById(ID).lean();
    throw new AppError(
      507,
      `Cloudflare storage is full: ${gb(current?.bytes || 0)} GB of ${gb(LIMIT_BYTES)} GB used. Delete old files or raise R2_STORAGE_LIMIT_GB.`
    );
  }
  try {
    await StorageReservation.create({ _id: key, bytes });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    // Lost a race with an identical upload: give our bytes back, theirs are already counted.
    await StorageUsage.updateOne({ _id: ID }, { $inc: { bytes: -bytes } });
    return false;
  }
  return true;
}

export async function isPending(key) {
  return Boolean(await StorageReservation.exists({ _id: key, status: "pending" }));
}

// Returns false if the real size is larger than reserved and the extra doesn't fit under the cap.
export async function markDone(key, actualBytes) {
  const reservation = await StorageReservation.findById(key);
  if (!reservation) return true;
  const delta = Number.isFinite(actualBytes) ? actualBytes - reservation.bytes : 0;
  if (delta > 0) {
    const ok = await StorageUsage.findOneAndUpdate({ _id: ID, bytes: { $lte: LIMIT_BYTES - delta } }, { $inc: { bytes: delta } });
    if (!ok) return false;
  } else if (delta < 0) {
    await StorageUsage.updateOne({ _id: ID }, { $inc: { bytes: delta } });
  }
  reservation.bytes = actualBytes;
  reservation.status = "done";
  await reservation.save();
  return true;
}

export async function release(key) {
  const reservation = await StorageReservation.findOneAndDelete({ _id: key, status: "pending" }).lean();
  if (reservation) await StorageUsage.updateOne({ _id: ID }, { $inc: { bytes: -reservation.bytes } });
}

export async function onObjectDeleted(key, bytes) {
  await StorageReservation.deleteOne({ _id: key });
  if (bytes > 0) await StorageUsage.updateOne({ _id: ID }, { $inc: { bytes: -bytes } });
}

export async function pendingKeys() {
  return new Set((await StorageReservation.find({ status: "pending" }).select("_id").lean()).map((r) => r._id));
}

// Called by the reconcile job with the real bucket totals.
export async function reconcile({ bucketBytes, objects }) {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS);
  await StorageReservation.deleteMany({ $or: [{ status: "pending", createdAt: { $lt: cutoff } }, { status: "done" }] });
  const pending = await StorageReservation.aggregate([{ $match: { status: "pending" } }, { $group: { _id: null, bytes: { $sum: "$bytes" } } }]);
  const bytes = bucketBytes + (pending[0]?.bytes || 0);
  await StorageUsage.updateOne({ _id: ID }, { $set: { bytes, objects, reconciledAt: new Date() } }, { upsert: true });
  return { bucketBytes, pendingBytes: pending[0]?.bytes || 0, objects };
}

export async function usage() {
  const doc = await StorageUsage.findById(ID).lean();
  const used = Math.max(0, doc?.bytes || 0);
  return {
    usedBytes: used,
    limitBytes: LIMIT_BYTES,
    percent: Math.min(100, Math.round((used / LIMIT_BYTES) * 1000) / 10),
    objects: doc?.objects ?? null,
    reconciledAt: doc?.reconciledAt ?? null
  };
}
