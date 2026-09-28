import express, { Router } from "express";
import { asyncHandler as h } from "../../core/asyncHandler.js";
import { rateLimit } from "../../core/rateLimit.js";
import * as users from "./users.service.js";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function page(res, status, body) {
  res
    .status(status)
    .type("html")
    .send(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>Unsubscribe</title><div style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:0 16px">${body}</div>`
    );
}

const unsubscribeLimit = rateLimit({ name: "unsubscribe", windowMs: 60_000, max: 30, store: "memory" });

export const publicRouter = Router();

// GET only shows a confirmation button. Email security scanners open links automatically,
// so unsubscribing on GET would silently unsubscribe people who never clicked.
publicRouter.get(
  "/unsubscribe/:token",
  unsubscribeLimit,
  h(async (req, res) => {
    const user = await users.findByUnsubscribeToken(req.params.token);
    if (!user) return page(res, 404, "<p>This unsubscribe link is invalid.</p>");
    if (!user.active) return page(res, 200, `<p>${escapeHtml(user.email)} is already unsubscribed.</p>`);
    page(
      res,
      200,
      `<p>Stop Mathematical Olympiad update emails to <strong>${escapeHtml(user.email)}</strong>?</p>` +
        `<form method="post"><button type="submit" style="padding:10px 16px">Unsubscribe</button></form>`
    );
  })
);

// POST performs it (also used by mail clients' one-click List-Unsubscribe-Post, RFC 8058).
publicRouter.post(
  "/unsubscribe/:token",
  unsubscribeLimit,
  express.urlencoded({ extended: false, limit: "1kb" }),
  h(async (req, res) => {
    const user = await users.unsubscribe(req.params.token);
    if (!user) return page(res, 404, "<p>This unsubscribe link is invalid.</p>");
    page(res, 200, `<p>${escapeHtml(user.email)} has been unsubscribed from Mathematical Olympiad updates.</p>`);
  })
);

export const adminRouter = Router();
adminRouter.get("/users", h(async (req, res) => res.json(await users.list(req.query))));
adminRouter.post("/users", h(async (req, res) => res.status(201).json(await users.create(req.body))));
adminRouter.put("/users/:id", h(async (req, res) => res.json(await users.update(req.params.id, req.body))));
