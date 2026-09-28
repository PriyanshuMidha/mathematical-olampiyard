import nodemailer from "nodemailer";
import { config } from "../../config/env.js";

let transporter;

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
