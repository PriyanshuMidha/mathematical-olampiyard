import bcrypt from "bcryptjs";
import { config } from "../config/env.js";
import { connectDB, disconnectDB } from "../config/db.js";
import Admin from "../modules/auth/admin.model.js";
import { BCRYPT_ROUNDS, assertStrongPassword } from "../modules/auth/auth.service.js";
import Taxonomy from "../modules/taxonomy/taxonomy.model.js";

// Non-destructive setup: creates/updates the admin account and adds any missing default
// levels/categories. It never deletes or inserts news, results, resources or users,
// so it is safe to run against a database that already holds real content.
const DEFAULT_LEVELS = ["Foundation", "Junior", "Senior", "National", "International"];
const DEFAULT_CATEGORIES = ["Registration", "Exam Date", "Result", "Syllabus", "Sample Paper", "Important Notice", "General"];

if (!config.admin.email || !config.admin.password) {
  console.error("Set ADMIN_EMAIL (username or email) and ADMIN_PASSWORD in backend/.env before seeding.");
  process.exit(1);
}
try {
  assertStrongPassword(config.admin.password);
} catch (error) {
  console.error(`ADMIN_PASSWORD: ${error.message}`);
  process.exit(1);
}

await connectDB();

const email = config.admin.email.toLowerCase().trim();
const passwordHash = await bcrypt.hash(config.admin.password, BCRYPT_ROUNDS);
await Admin.findOneAndUpdate({ email }, { $set: { passwordHash }, $inc: { tokenVersion: 1 }, $setOnInsert: { name: "Olympiad Admin" } }, { upsert: true, new: true });
console.log(`Admin ready: ${email}`);

const defaults = [...DEFAULT_LEVELS.map((name) => ({ type: "level", name })), ...DEFAULT_CATEGORIES.map((name) => ({ type: "category", name }))];
let added = 0;
for (const item of defaults) {
  const result = await Taxonomy.updateOne(item, { $setOnInsert: item }, { upsert: true });
  added += result.upsertedCount;
}
console.log(`Levels/categories: ${added} added, ${defaults.length - added} already present`);
console.log("Seed complete");
await disconnectDB();
