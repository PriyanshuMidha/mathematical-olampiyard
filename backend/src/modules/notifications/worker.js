import { config } from "../../config/env.js";
import { emitSafe, events } from "../../core/events.js";
import { recipientsBatch } from "../users/users.service.js";
import EmailDelivery from "./emailDelivery.model.js";
import EmailJob from "./emailJob.model.js";
import { getTransport, isMailConfigured } from "./mailer.js";

// Background email sender. Safe to run in every app instance: a job is claimed atomically
// (lockedUntil), so only one instance works on it; a crashed instance's lock expires and
// another instance resumes from the saved cursor.
const { pollMs, batchSize, concurrency, lockMs } = config.notifications;
const MAX_ATTEMPTS = 5;
let timer;
let running = false;
let stopped = true;

function claimNext() {
  const now = new Date();
  return EmailJob.findOneAndUpdate(
    {
      status: { $in: ["queued", "sending"] },
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }]
    },
    { $set: { status: "sending", lockedUntil: new Date(now.getTime() + lockMs) }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, new: true }
  );
}

function renderEmail(job, recipient) {
  const detailUrl = `${config.clientUrl}/news/${job.news.slug}`;
  const unsubscribeUrl = `${config.apiUrl}/api/unsubscribe/${recipient.unsubscribeToken}`;
  const text = [
    recipient.name ? `Hi ${recipient.name},` : "Hello,",
    "",
    job.news.title,
    "",
    job.news.shortDescription,
    "",
    `Level: ${job.news.level}`,
    `Category: ${job.news.category}`,
    "",
    `Read more: ${detailUrl}`,
    "",
    `Unsubscribe: ${unsubscribeUrl}`
  ].join("\n");

  return {
    from: config.smtp.from,
    to: recipient.email,
    subject: `New Mathematical Olympiad update: ${job.news.title}`,
    text,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
  };
}

// Claims the recipient first (unique index), then sends. If the claim already exists the recipient
// was handled by an earlier (crashed) attempt and is skipped. If sending fails the claim is released.
async function deliver(job, recipient) {
  try {
    await EmailDelivery.create({ jobId: job._id, subscriberId: recipient._id });
  } catch (error) {
    if (error?.code === 11000) return "skipped";
    throw error;
  }
  try {
    await getTransport().sendMail(renderEmail(job, recipient));
    return "sent";
  } catch (error) {
    await EmailDelivery.deleteOne({ jobId: job._id, subscriberId: recipient._id }).catch(() => {});
    throw error;
  }
}

async function sendInChunks(job, recipients) {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += concurrency) {
    const chunk = recipients.slice(i, i + concurrency);
    const results = await Promise.allSettled(chunk.map((r) => deliver(job, r)));
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value === "sent") sent += 1;
      } else {
        failed += 1;
        console.error("Email send failed:", result.reason?.message || result.reason);
      }
    }
  }
  return { sent, failed };
}

async function processJob(job) {
  if (!isMailConfigured()) {
    await EmailJob.updateOne({ _id: job._id }, { status: "skipped", lastError: "SMTP not configured", lockedUntil: null });
    return;
  }

  let cursor = job.cursor;
  for (;;) {
    const recipients = await recipientsBatch(job.news.category, cursor, batchSize);
    if (!recipients.length) break;

    const { sent, failed } = await sendInChunks(job, recipients);
    cursor = recipients[recipients.length - 1]._id;
    // Save progress and extend the lock after every batch.
    await EmailJob.updateOne(
      { _id: job._id },
      { $set: { cursor, lockedUntil: new Date(Date.now() + lockMs) }, $inc: { sent, failed } }
    );
  }

  const sentAt = new Date();
  await EmailJob.updateOne({ _id: job._id }, { status: "sent", finishedAt: sentAt, lockedUntil: null });
  emitSafe("notification:sent", { newsId: job.newsId, sentAt });
}

async function tick() {
  if (running || stopped) return;
  running = true;
  try {
    for (let job = await claimNext(); job && !stopped; job = await claimNext()) {
      try {
        await processJob(job);
      } catch (error) {
        console.error("Email job failed:", error);
        const giveUp = job.attempts >= MAX_ATTEMPTS;
        await EmailJob.updateOne(
          { _id: job._id },
          // Retry later from the saved cursor (lock left to expire as a back-off), or give up.
          { $set: { lastError: String(error.message || error).slice(0, 1000), ...(giveUp ? { status: "failed", lockedUntil: null } : {}) } }
        );
      }
    }
  } catch (error) {
    console.error("Email worker error:", error.message);
  } finally {
    running = false;
  }
}

export function startNotificationWorker() {
  stopped = false;
  timer = setInterval(tick, pollMs);
  timer.unref();
  events.on("news:email-queued", tick);
  tick();
}

export function stopNotificationWorker() {
  stopped = true;
  clearInterval(timer);
  events.off("news:email-queued", tick);
}
