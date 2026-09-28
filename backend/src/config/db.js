import mongoose from "mongoose";
import { config } from "./env.js";

function explainMongoError(error) {
  if (error?.name === "MongooseServerSelectionError") {
    return new Error(
      [
        "MongoDB Atlas connection failed.",
        "Most likely fix: add your current public IP address in Atlas -> Network Access -> Add IP Address.",
        "Also confirm the database username/password and that the cluster is running.",
        "Original error: " + error.message
      ].join("\n")
    );
  }
  return error;
}

export async function connectDB() {
  const { uri, autoIndex, ...options } = config.mongo;
  mongoose.set("bufferCommands", false);
  mongoose.set("autoIndex", autoIndex);
  // Unknown query-filter fields are dropped instead of silently matching everything.
  mongoose.set("strictQuery", true);

  try {
    await mongoose.connect(uri, options);
  } catch (error) {
    throw explainMongoError(error);
  }

  // Warm the pool before accepting traffic so the first requests don't each pay a new connection handshake.
  const db = mongoose.connection.db;
  await Promise.all(Array.from({ length: Math.max(1, options.minPoolSize) }, () => db.admin().ping()));
  console.log("MongoDB connected");
}

export function isDbReady() {
  return mongoose.connection.readyState === 1;
}

export function disconnectDB() {
  return mongoose.disconnect();
}
