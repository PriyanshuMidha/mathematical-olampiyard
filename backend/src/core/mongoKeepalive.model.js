import mongoose from "mongoose";

// One fixed row, updated on every keep-alive tick. Its presence + updatedAt is visible proof
// (in the DB itself, and on the admin Dashboard) that something is actively writing to MongoDB.
const keepaliveSchema = new mongoose.Schema(
  { _id: { type: String, default: "keepalive" }, pings: { type: Number, default: 0 }, lastPingAt: Date },
  { versionKey: false }
);

export default mongoose.model("MongoKeepalive", keepaliveSchema);
