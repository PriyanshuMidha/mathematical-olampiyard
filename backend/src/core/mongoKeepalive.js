import mongoose from "mongoose";
import { config } from "../config/env.js";
import { registerJob } from "./scheduler.js";
import MongoKeepalive from "./mongoKeepalive.model.js";

// Some hosting/DB plans reclaim resources after a long stretch with no real activity. This job makes
// sure MongoDB always sees genuine, recent activity - a connection ping plus an actual write - however
// far apart it's configured to run (default: daily, MONGO_KEEPALIVE_MS), comfortably inside any such window.
//
// Caveat: this only runs while the app itself is running. Render's free tier (and similar hosts) put the
// whole app to sleep after ~15 minutes with no incoming web request - at that point no in-app job can fire,
// keepalive included. If the app is asleep for the whole gap between two scheduled runs, MongoDB goes that
// long without a ping too. Pairing this with an external uptime ping (e.g. UptimeRobot hitting /api/health
// every 10-14 min) keeps the app itself awake, which is what lets this job actually run on schedule.
registerJob({
  name: "mongo-keepalive",
  everyMs: config.jobs.mongoKeepaliveMs,
  run: async () => {
    await mongoose.connection.db.admin().ping();
    const now = new Date();
    const doc = await MongoKeepalive.findOneAndUpdate(
      { _id: "keepalive" },
      { $set: { lastPingAt: now }, $inc: { pings: 1 } },
      { upsert: true, new: true, lean: true }
    );
    return { pingedAt: now.toISOString(), totalPings: doc.pings };
  }
});
