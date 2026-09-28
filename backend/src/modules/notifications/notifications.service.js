import { emitSafe } from "../../core/events.js";
import { countRecipients } from "../users/users.service.js";
import EmailJob from "./emailJob.model.js";
import { isMailConfigured } from "./mailer.js";

// Called by the news module when a news item is published with "send email" ticked.
// Returns immediately; the worker sends emails in the background.
export async function enqueueNewsEmail({ newsId, ...news }) {
  if (!isMailConfigured()) {
    const recipients = await countRecipients(news.category);
    console.log(`Email notification skipped: SMTP is not configured. Intended recipients: ${recipients}`);
    return { skipped: true, recipients };
  }

  const existing = await EmailJob.findOne({ newsId }).lean();
  if (existing && ["queued", "sending", "sent"].includes(existing.status)) return { queued: existing.status !== "sent" };

  try {
    await EmailJob.findOneAndUpdate(
      { newsId, status: { $nin: ["queued", "sending", "sent"] } },
      { $set: { news, status: "queued", lastError: null, lockedUntil: null }, $setOnInsert: { newsId } },
      { upsert: true }
    );
  } catch (error) {
    // Another request queued it at the same moment (unique newsId) - that's fine.
    if (error?.code !== 11000) throw error;
  }
  emitSafe("news:email-queued", { newsId });
  return { queued: true };
}
