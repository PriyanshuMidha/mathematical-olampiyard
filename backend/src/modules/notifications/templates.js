import { config } from "../../config/env.js";
import { senderFields } from "./mailer.js";

// Email layouts: plain text (always readable) + simple HTML with inline styles (what email clients support).
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function layout({ preheader, body, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f7f9;font-family:Arial,Helvetica,sans-serif;color:#101722">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d5dce4;border-radius:14px;overflow:hidden">
<tr><td style="background:#124bd8;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:.3px">Mathematical Olympiad</td></tr>
<tr><td style="padding:28px">${body}</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #e5eaf0;color:#65707d;font-size:12px;line-height:1.6">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(url, label) {
  return `<a href="${esc(url)}" style="display:inline-block;background:#124bd8;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">${esc(label)}</a>`;
}

export function newsEmail({ news, recipient, unsubscribeUrl }) {
  const detailUrl = `${config.clientUrl}/news/${news.slug}`;
  const greeting = recipient.name ? `Hi ${recipient.name},` : "Hello,";
  const text = [
    greeting,
    "",
    news.title,
    "",
    news.shortDescription,
    "",
    `Level: ${news.level}`,
    `Category: ${news.category}`,
    "",
    `Read more: ${detailUrl}`,
    "",
    "You receive this because you subscribed to Mathematical Olympiad updates.",
    `Unsubscribe: ${unsubscribeUrl}`
  ].join("\n");

  const html = layout({
    preheader: news.shortDescription,
    body: `<p style="margin:0 0 16px;font-size:15px">${esc(greeting)}</p>
<p style="margin:0 0 6px;color:#124bd8;font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:.6px">${esc(news.category)} · ${esc(news.level)}</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${esc(news.title)}</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#374151">${esc(news.shortDescription)}</p>
${button(detailUrl, "Read the full update")}`,
    footer: `You receive this because you subscribed to Mathematical Olympiad updates.<br><a href="${esc(unsubscribeUrl)}" style="color:#65707d">Unsubscribe</a>`
  });

  return {
    ...senderFields(),
    to: recipient.email,
    subject: `New Mathematical Olympiad update: ${news.title}`,
    text,
    html,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
  };
}

export function confirmationEmail({ email, confirmUrl }) {
  const text = [
    "Please confirm your email",
    "",
    "Someone (hopefully you) asked to receive Mathematical Olympiad news updates at this address.",
    `Confirm: ${confirmUrl}`,
    "",
    "If this wasn't you, ignore this email - you won't receive anything else from us.",
    "The link is valid for 7 days."
  ].join("\n");
  const html = layout({
    preheader: "Confirm to start receiving Mathematical Olympiad updates",
    body: `<h1 style="margin:0 0 12px;font-size:22px">Please confirm your email</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#374151">Someone (hopefully you) asked to receive Mathematical Olympiad news updates at <strong>${esc(email)}</strong>.</p>
${button(confirmUrl, "Confirm my email")}`,
    footer: "If this wasn't you, ignore this email — you won't receive anything else from us. The link is valid for 7 days."
  });
  return { ...senderFields(), to: email, subject: "Confirm your Mathematical Olympiad updates", text, html };
}
