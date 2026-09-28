import { config } from "../../config/env.js";
import EmailJob from "./emailJob.model.js";
import { isMailConfigured, providerName, sentToday } from "./mailer.js";
import { workerState } from "./worker.js";

// Everything the dashboard needs to show that email sending is set up and running.
export async function emailStatus() {
  const [today, queued, sending, lastJob] = await Promise.all([
    sentToday(),
    EmailJob.countDocuments({ status: "queued" }),
    EmailJob.countDocuments({ status: "sending" }),
    EmailJob.findOne().sort({ updatedAt: -1 }).select("status sent failed finishedAt lastError lockedUntil").lean()
  ]);
  return {
    configured: isMailConfigured(),
    provider: providerName(),
    from: config.smtp.from,
    replyTo: config.smtp.replyTo || null,
    dailyLimit: config.notifications.dailyLimit || null,
    sentToday: today,
    queued,
    sending,
    lastJob,
    worker: workerState()
  };
}
