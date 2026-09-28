import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../../config/env.js";
import { badRequest, conflict, notFound, tooMany, unauthorized } from "../../core/errors.js";
import { hit, peek, resetHits } from "../../core/rateLimit.js";
import Admin from "./admin.model.js";
import RevokedToken from "./revokedToken.model.js";

const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
// Failed logins are limited per (account + client network) so an attacker can't lock the real admin
// out from elsewhere, plus a much higher per-account total that slows attacks spread over many IPs.
const ACCOUNT_MAX_FAILURES_PER_CLIENT = 10;
const ACCOUNT_MAX_FAILURES_TOTAL = 100;
// Networks an admin has successfully logged in from recently are exempt from the account-wide ceiling,
// so an attacker spreading guesses over many networks can't lock the real admin out.
const TRUSTED_WINDOW_MS = 30 * 24 * 60 * 60_000;
// bcryptjs runs on the main thread; 10 is the accepted minimum and keeps logins ~100ms of CPU.
export const BCRYPT_ROUNDS = 10;
// Compared against when the account doesn't exist, so response time doesn't reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

export function publicAdmin(admin) {
  return { id: admin._id, name: admin.name, email: admin.email, createdAt: admin.createdAt };
}

export function assertStrongPassword(password) {
  if (typeof password !== "string" || password.length < 10) throw badRequest("Password must be at least 10 characters");
  if (password.length > 200) throw badRequest("Password is too long");
  if (password === "Admin@12345") throw badRequest("That password is publicly known; choose another");
}

function identifierOf(value) {
  if (typeof value !== "string" || !value.trim()) throw badRequest("Username is required");
  const id = value.toLowerCase().trim();
  if (id.length > 254 || !/^[a-z0-9._@+-]+$/.test(id)) throw badRequest("Username may contain letters, numbers and . _ @ + -");
  return id;
}

function sign(admin) {
  return jwt.sign({ sub: String(admin._id), ver: admin.tokenVersion || 0, jti: crypto.randomUUID() }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: config.jwt.issuer,
    algorithm: "HS256"
  });
}

// Returns { token, expiresAt, admin }. The route puts the token in an httpOnly cookie.
function session(admin) {
  const token = sign(admin);
  return { token, expiresAt: jwt.decode(token).exp * 1000, admin: publicAdmin(admin) };
}

export async function login({ email, password }, client = "unknown") {
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    throw badRequest("Username and password are required");
  }
  if (email.length > 254 || password.length > 200) throw unauthorized("Invalid credentials");

  const identifier = email.toLowerCase().trim();
  const clientAccountKey = `login-account:${identifier}:${client}`;
  const accountKey = `login-account-total:${identifier}`;
  const window = { windowMs: ACCOUNT_WINDOW_MS };
  const locked = () => tooMany("Too many failed attempts for this account. Try again in 15 minutes.");

  const trustedKey = `login-trusted:${identifier}:${client}`;
  // Checked BEFORE the password: a locked client gets no answer about whether a guess was right.
  const [clientFailures, totalFailures, trusted] = await Promise.all([
    peek(clientAccountKey, window),
    peek(accountKey, window),
    peek(trustedKey, { windowMs: TRUSTED_WINDOW_MS })
  ]);
  if (clientFailures >= ACCOUNT_MAX_FAILURES_PER_CLIENT) throw locked();
  if (totalFailures >= ACCOUNT_MAX_FAILURES_TOTAL && !trusted) throw locked();
  const admin = await Admin.findOne({ email: identifier }).lean();
  const valid = await bcrypt.compare(password, admin?.passwordHash || DUMMY_HASH);

  if (!admin || !valid) {
    const [fromClient, total] = await Promise.all([hit(clientAccountKey, window), hit(accountKey, window)]);
    if (fromClient > ACCOUNT_MAX_FAILURES_PER_CLIENT || (total > ACCOUNT_MAX_FAILURES_TOTAL && !trusted)) throw locked();
    throw unauthorized("Invalid credentials");
  }

  await resetHits(clientAccountKey, window);
  await hit(trustedKey, { windowMs: TRUSTED_WINDOW_MS });
  return session(admin);
}

export async function verifyToken(token) {
  const payload = jwt.verify(token, config.jwt.secret, { algorithms: ["HS256"], issuer: config.jwt.issuer });
  if (payload.jti && (await RevokedToken.exists({ _id: payload.jti }))) return null;
  // Looked up on every request: deleting an admin or changing their password revokes old sessions at once.
  const admin = await Admin.findById(payload.sub).select("-passwordHash").lean();
  if (!admin || (admin.tokenVersion || 0) !== (payload.ver || 0)) return null;
  return admin;
}

// Ends this session on the server (not just in the browser), until its natural expiry.
export async function logout(token) {
  try {
    const payload = jwt.verify(token, config.jwt.secret, { algorithms: ["HS256"], issuer: config.jwt.issuer });
    if (payload.jti) await RevokedToken.updateOne({ _id: payload.jti }, { $set: { expiresAt: new Date(payload.exp * 1000) } }, { upsert: true });
  } catch {
    /* invalid/expired token: nothing to revoke */
  }
}

export async function changeOwnPassword(adminId, { currentPassword, newPassword }) {
  const admin = await Admin.findById(adminId);
  if (!admin) throw notFound("Admin");
  if (typeof currentPassword !== "string" || !(await bcrypt.compare(currentPassword, admin.passwordHash))) {
    throw badRequest("Current password is incorrect");
  }
  assertStrongPassword(newPassword);
  admin.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  admin.tokenVersion = (admin.tokenVersion || 0) + 1; // logs out every other session
  await admin.save();
  return session(admin); // fresh session for the current browser
}

// ---------- admin management ----------

export async function listAdmins() {
  const admins = await Admin.find().sort({ createdAt: 1 }).select("-passwordHash").lean();
  return admins.map(publicAdmin);
}

export async function createAdmin({ name, email, password }) {
  const identifier = identifierOf(email);
  assertStrongPassword(password);
  if (await Admin.exists({ email: identifier })) throw conflict("An admin with that username already exists");
  const admin = await Admin.create({
    name: typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : "Administrator",
    email: identifier,
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS)
  });
  return publicAdmin(admin);
}

export async function resetAdminPassword(actorId, targetId, { password }) {
  if (String(actorId) === String(targetId)) throw badRequest("Use 'Change my password' for your own account");
  assertStrongPassword(password);
  const admin = await Admin.findById(targetId);
  if (!admin) throw notFound("Admin");
  admin.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  admin.tokenVersion = (admin.tokenVersion || 0) + 1;
  await admin.save();
  return publicAdmin(admin);
}

export async function deleteAdmin(actorId, targetId) {
  if (String(actorId) === String(targetId)) throw badRequest("You can't delete your own account");
  const admin = await Admin.findById(targetId);
  if (!admin) throw notFound("Admin");
  if ((await Admin.countDocuments()) <= 1) throw conflict("At least one admin must remain");
  await admin.deleteOne();
  // Two admins deleting each other at the same moment could both pass the check above: undo if none remain.
  if ((await Admin.countDocuments()) === 0) {
    await Admin.create(admin.toObject());
    throw conflict("At least one admin must remain");
  }
}
