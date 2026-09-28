import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/db.js";
// Importing the module registry registers every model.
import "../modules/index.js";
import "../modules/notifications/worker.js"; // registers EmailDelivery (not reachable from the routes)

// Creates/updates indexes for all models. Run on deploy (production sets MONGO_AUTO_INDEX=false).
await connectDB();
for (const model of Object.values(mongoose.models)) {
  await model.syncIndexes();
  console.log(`Indexes synced: ${model.modelName}`);
}
await disconnectDB();
