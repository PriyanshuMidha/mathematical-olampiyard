import { config } from "../../config/env.js";
import { emitSafe, events } from "../../core/events.js";
import { windowEnd } from "../../core/rateLimit.js";
import { recipientsBatch } from "../users/users.service.js";
import EmailDelivery from "./emailDelivery.model.js";
import EmailJob from "./emailJob.model.js";
import { getTransport, isMailConfigured, takeDailySlot } from "./mailer.js";
import { newsEmail } from "./templates.js";

// Background email sender. Safe to run in every app instance: a job is claimed atomically
// (lockedUntil), so only one instance works on it; a crashed instance's lock expires and
// another instance resumes from the saved cursor.
const { pollMs, batchSize, concurrency, lockMs, dailyLimit } = config.notifications;
const DAY_MS = 24 * 60 * 60_000;
// Temporary provider problems are retried with growing pauses (5 min, 10, 20 ... up to 6 h),
// so an outage of up to about a day doesn't lose the newsletter.
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
let timer;
let running = false;
let stopped = true;
let lastTickAt = null;

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
  const unsubscribeUrl = `${config.apiUrl}/api/unsubscribe/${recipient.unsubscribeToken}`;
  return newsEmail({ news: job.news, recipient, unsubscribeUrl });
}

class DailyLimitReached extends Error {}

// A 5xx answer about one recipient (e.g. "mailbox does not exist") is permanent: skip that address.
// Everything else - connection refused, timeout, login failed, 4xx "try later" - means the provider or
// our settings have a problem, so the job must stop and retry later instead of skipping everyone.
function isPermanentRecipientError(error) {
  return Number(error?.responseCode) >= 500 && error?.code !== "EAUTH";
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
  if (!(await takeDailySlot())) {
    await EmailDelivery.deleteOne({ jobId: job._id, subscriberId: recipient._id });
    throw new DailyLimitReached();
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
  let paused = false;
  let transientError = null;
  for (let i = 0; i < recipients.length && !paused && !transientError; i += concurrency) {
    const chunk = recipients.slice(i, i + concurrency);
    const results = await Promise.allSettled(chunk.map((r) => deliver(job, r)));
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value === "sent") sent += 1;
      } else if (result.reason instanceof DailyLimitReached) {
        paused = true;
      } else if (isPermanentRecipientError(result.reason)) {
        failed += 1;
        console.error("Email rejected for one recipient:", result.reason?.message || result.reason);
      } else {
        transientError = result.reason;
      }
    }
  }
  return { sent, failed, paused, transientError };
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

    const { sent, failed, paused, transientError } = await sendInChunks(job, recipients);
    if (transientError) {
      // Keep the cursor where it is; recipients already emailed are skipped on retry via their delivery rows.
      await EmailJob.updateOne({ _id: job._id }, { $inc: { sent, failed } });
      throw new Error(`Email provider problem, will retry: ${transientError.message || transientError}`);
    }
    if (paused) {
      // Daily quota used up: keep the job and the cursor where they are (already-emailed users are skipped
      // on resume thanks to their delivery rows) and continue after the quota resets at midnight UTC.
      const resumeAt = new Date(windowEnd(DAY_MS));
      await EmailJob.updateOne(
        { _id: job._id },
        { $set: { lockedUntil: resumeAt, lastError: `Daily email limit (${dailyLimit}) reached; continues ${resumeAt.toISOString()}` }, $inc: { sent, failed, attempts: -1 } }
      );
      console.log(`Email job ${job._id}: daily limit of ${dailyLimit} reached, resuming at ${resumeAt.toISOString()}`);
      return;
    }
    cursor = recipients[recipients.length - 1]._id;
    // Save progress and extend the lock after every batch.
    await EmailJob.updateOne(
      { _id: job._id },
      { $set: { cursor, lockedUntil: new Date(Date.now() + lockMs) }, $inc: { sent, failed } }
    );
  }

  const sentAt = new Date();
  await EmailJob.updateOne({ _id: job._id }, { $set: { status: "sent", finishedAt: sentAt, lockedUntil: null, lastError: null }, $unset: { news: 1, cursor: 1 } });
  // Per-recipient rows only matter while a job can still be resumed; a finished job is never re-run.
  await EmailDelivery.deleteMany({ jobId: job._id });
  emitSafe("notification:sent", { newsId: job.newsId, sentAt });
}

async function tick() {
  if (running || stopped) return;
  running = true;
  lastTickAt = new Date();
  try {
    for (let job = await claimNext(); job && !stopped; job = await claimNext()) {
      try {
        await processJob(job);
      } catch (error) {
        console.error("Email job failed:", error);
        const giveUp = job.attempts >= MAX_ATTEMPTS;
        const retryAt = new Date(Date.now() + Math.min(lockMs * 2 ** Math.max(0, job.attempts - 1), MAX_BACKOFF_MS));
        await EmailJob.updateOne(
          { _id: job._id },
          // Retry later from the saved cursor, or give up (news can be re-queued by saving it again).
          { $set: { lastError: String(error.message || error).slice(0, 1000), ...(giveUp ? { status: "failed", lockedUntil: null } : { lockedUntil: retryAt }) } }
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

// For the dashboard: proves the background worker is alive in this server process.
export function workerState() {
  return { started: !stopped, busy: running, lastCheckAt: lastTickAt, pollSeconds: Math.round(pollMs / 1000) };
}
