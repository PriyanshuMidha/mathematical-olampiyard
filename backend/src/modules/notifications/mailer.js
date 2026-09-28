import nodemailer from "nodemailer";
import { config } from "../../config/env.js";
import { hit, peek } from "../../core/rateLimit.js";

// All outgoing email goes through Nodemailer over SMTP to the provider in SMTP_* (Brevo, Ethereal, ...).
let transporter;
const DAY_MS = 24 * 60 * 60_000;

export function isMailConfigured() {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}

// One pooled transport per process (reuses SMTP connections instead of opening one per email).
export function getTransport() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      pool: true,
      maxConnections: config.notifications.concurrency,
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass }
    });
  }
  return transporter;
}

export function closeTransport() {
  transporter?.close();
  transporter = undefined;
}

// Sender fields shared by every email.
export function senderFields() {
  return { from: config.smtp.from, ...(config.smtp.replyTo ? { replyTo: config.smtp.replyTo } : {}) };
}

// One slot of the provider's daily quota, counted in MongoDB so all servers share it.
export async function takeDailySlot() {
  const limit = config.notifications.dailyLimit;
  if (!limit) return true;
  return (await hit("email-daily", { windowMs: DAY_MS })) <= limit;
}

export async function sentToday() {
  return peek("email-daily", { windowMs: DAY_MS });
}

export function providerName() {
  const host = config.smtp.host || "";
  if (!host) return "not configured";
  if (host.includes("ethereal")) return "Ethereal (test inbox, not delivered)";
  if (host.includes("brevo")) return "Brevo";
  if (host.includes("amazonaws")) return "Amazon SES";
  if (host.includes("mailjet")) return "Mailjet";
  if (host.includes("resend")) return "Resend";
  if (host.includes("smtp2go")) return "SMTP2GO";
  if (host.includes("mailgun")) return "Mailgun";
  return host;
}
