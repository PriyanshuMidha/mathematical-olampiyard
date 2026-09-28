import crypto from "crypto";
import { badRequest, notFound } from "../../core/errors.js";
import { contentChanged } from "../../core/contentChanged.js";
import { EMAIL_PATTERN, pick, toBool } from "../../core/validate.js";
import { sendSubscriptionConfirmation } from "../notifications/confirmation.js";
import Subscriber, { PREFERENCES } from "./subscriber.model.js";

// Which preferences receive a news item of a given category ("All updates" gets everything).
const PREFERENCE_CATEGORIES = {
  "Results only": ["Result"],
  "Exam dates": ["Exam Date", "Registration"],
  Resources: ["Syllabus", "Sample Paper"]
};

const HIDDEN = "-unsubscribeToken -confirmToken";

function safe(doc) {
  const { unsubscribeToken, confirmToken, ...rest } = doc.toObject ? doc.toObject() : doc;
  return rest;
}

function input(body, { partial }) {
  const data = pick(body, ["name", "email", "preference"]);
  if (data.name !== undefined && typeof data.name !== "string") throw badRequest("Name must be text");
  if (data.email !== undefined && typeof data.email !== "string") throw badRequest("A valid email is required");
  if (typeof data.name === "string") data.name = data.name.trim();
  if (typeof data.email === "string") data.email = data.email.toLowerCase().trim();
  if ((!partial || data.name !== undefined) && !data.name) throw badRequest("Name is required");
  if ((!partial || data.email !== undefined) && !EMAIL_PATTERN.test(data.email || "")) throw badRequest("A valid email is required");
  if (data.preference !== undefined && !PREFERENCES.includes(data.preference)) {
    throw badRequest(`Preference must be one of: ${PREFERENCES.join(", ")}`);
  }
  if (body.active !== undefined) data.active = toBool(body.active);
  return data;
}

export function list(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 1000, 1), 5000);
  return Subscriber.find().sort({ createdAt: -1 }).limit(limit).select(HIDDEN).lean();
}

export async function create(body) {
  const user = await Subscriber.create(input(body, { partial: false }));
  contentChanged("users");
  return safe(user);
}

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60_000;
const SIGNUP_REPLY = { ok: true, message: "Check your inbox: we sent you a link to confirm your email." };

// Public sign-up with double opt-in. Anyone can type any address into a form, so:
// - nobody is emailed news until the owner clicks the confirmation link;
// - an existing active subscriber is never changed by this form (a stranger can't alter their settings);
// - the reply is identical whatever happens, so the form doesn't reveal who is subscribed.
export async function subscribe(body) {
  const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw badRequest("A valid email is required");
  const preference = body.preference === undefined ? "All updates" : body.preference;
  if (!PREFERENCES.includes(preference)) throw badRequest(`Preference must be one of: ${PREFERENCES.join(", ")}`);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";

  const existing = await Subscriber.findOne({ email }).select("active").lean();
  if (existing?.active) return SIGNUP_REPLY;

  const token = crypto.randomBytes(24).toString("hex");
  try {
    await Subscriber.updateOne(
      { email, active: { $ne: true } },
      {
        $set: { preference, active: false, confirmToken: token, confirmSentAt: new Date(), ...(name ? { name } : {}) },
        $setOnInsert: { unsubscribeToken: crypto.randomBytes(24).toString("hex"), source: "public" }
      },
      { upsert: true }
    );
  } catch (error) {
    if (error?.code === 11000) return SIGNUP_REPLY; // same address submitted twice at once
    throw error;
  }
  // Not awaited: the reply must take the same time whether or not an email goes out (no subscriber probing).
  sendSubscriptionConfirmation({ email, token });
  return SIGNUP_REPLY;
}

function validToken(token) {
  return typeof token === "string" && /^[a-f0-9]{48}$/.test(token);
}

export async function findByConfirmToken(token) {
  if (!validToken(token)) return null;
  return Subscriber.findOne({ confirmToken: token, confirmSentAt: { $gt: new Date(Date.now() - CONFIRM_TTL_MS) } }).select("email").lean();
}

export async function confirmSubscription(token) {
  if (!validToken(token)) return null;
  const user = await Subscriber.findOneAndUpdate(
    { confirmToken: token, confirmSentAt: { $gt: new Date(Date.now() - CONFIRM_TTL_MS) } },
    { $set: { active: true, confirmedAt: new Date() }, $unset: { confirmToken: 1 } },
    { new: true }
  )
    .select("email")
    .lean();
  if (user) contentChanged("users");
  return user;
}

export async function update(id, body) {
  const user = await Subscriber.findById(id);
  if (!user) throw notFound("User");
  user.set(input(body, { partial: true }));
  await user.save();
  contentChanged("users");
  return safe(user);
}

export function activeCount() {
  return Subscriber.countDocuments({ active: true });
}

function preferencesFor(category) {
  return ["All updates", ...Object.keys(PREFERENCE_CATEGORIES).filter((p) => PREFERENCE_CATEGORIES[p].includes(category))];
}

export function countRecipients(category) {
  return Subscriber.countDocuments({ active: true, preference: { $in: preferencesFor(category) } });
}

// Cursor-based batches so any number of recipients can be processed without loading them all into memory.
export async function recipientsBatch(category, afterId, limit) {
  const filter = { active: true, preference: { $in: preferencesFor(category) } };
  if (afterId) filter._id = { $gt: afterId };
  const batch = await Subscriber.find(filter).sort({ _id: 1 }).limit(limit).select("name email unsubscribeToken").lean();

  // Older records may predate unsubscribe tokens.
  await Promise.all(
    batch
      .filter((s) => !s.unsubscribeToken)
      .map(async (s) => {
        s.unsubscribeToken = crypto.randomBytes(24).toString("hex");
        await Subscriber.updateOne({ _id: s._id }, { unsubscribeToken: s.unsubscribeToken });
      })
  );
  return batch;
}

export async function findByUnsubscribeToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) return null;
  return Subscriber.findOne({ unsubscribeToken: token }).select("email active").lean();
}

export async function unsubscribe(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) return null;
  const user = await Subscriber.findOneAndUpdate({ unsubscribeToken: token }, { active: false }, { new: true }).select("email").lean();
  if (user) contentChanged("users");
  return user;
}
