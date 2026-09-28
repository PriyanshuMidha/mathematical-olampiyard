import { config } from "../../config/env.js";
import { hit } from "../../core/rateLimit.js";
import { getTransport, isMailConfigured, takeDailySlot } from "./mailer.js";
import { confirmationEmail } from "./templates.js";

const DAY_MS = 24 * 60 * 60_000;
const MAX_CONFIRMATIONS_PER_ADDRESS_PER_DAY = 3; // stops anyone flooding a stranger's inbox via the form

// Sends the double-opt-in email. Never throws to the caller: the sign-up response is the same either way.
export async function sendSubscriptionConfirmation({ email, token }) {
  const confirmUrl = `${config.apiUrl}/api/subscribe/confirm/${token}`;
  try {
    if (!isMailConfigured()) {
      if (!config.isProd) console.log(`[email not configured] Confirmation link for ${email}: ${confirmUrl}`);
      return { skipped: true };
    }
    if ((await hit(`confirm-email:${email}`, { windowMs: DAY_MS })) > MAX_CONFIRMATIONS_PER_ADDRESS_PER_DAY) return { throttled: true };
    // Own budget first, so sign-ups can't consume the quota reserved for news emails.
    if ((await hit("email-confirm-daily", { windowMs: DAY_MS })) > config.notifications.confirmDailyLimit) {
      console.warn("Daily budget for sign-up confirmation emails reached");
      return { dailyLimit: true };
    }
    if (!(await takeDailySlot())) {
      console.warn("Daily email limit reached: confirmation email not sent");
      return { dailyLimit: true };
    }
    await getTransport().sendMail(confirmationEmail({ email, confirmUrl }));
    return { sent: true };
  } catch (error) {
    console.error("Confirmation email failed:", error.message);
    return { error: true };
  }
}
