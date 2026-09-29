import { Router } from "express";
import { config } from "../../config/env.js";
import { asyncHandler as h } from "../../core/asyncHandler.js";
import { readCookie } from "../../core/cookies.js";
import { clientKey, rateLimit } from "../../core/rateLimit.js";
import * as auth from "./auth.service.js";

const loginIpLimit = rateLimit({
  name: "login-ip",
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many login attempts, try again later"
});

function isAllowedCrossSiteOrigin(req) {
  const origin = req.get("Origin");
  if (!origin || !config.clientUrls.includes(origin)) return false;
  try {
    return new URL(origin).origin !== new URL(config.apiUrl).origin;
  } catch {
    return origin !== config.apiUrl;
  }
}

function cookieOptions(expiresAt, req) {
  const crossSite = req && isAllowedCrossSiteOrigin(req);
  return {
    httpOnly: true,
    secure: crossSite ? true : config.cookie.secure,
    sameSite: crossSite ? "none" : config.cookie.sameSite,
    domain: config.cookie.domain,
    path: "/api",
    ...(expiresAt ? { expires: new Date(expiresAt) } : {})
  };
}

function sendSession(req, res, { token, expiresAt, admin }) {
  res.cookie(config.cookie.name, token, cookieOptions(expiresAt, req));
  // The token itself is never sent to page JavaScript.
  res.json({ admin, expiresAt });
}

// Mounted before requireAdmin.
export const openAdminRouter = Router();
openAdminRouter.post("/login", loginIpLimit, h(async (req, res) => sendSession(req, res, await auth.login(req.body, clientKey(req)))));
openAdminRouter.post(
  "/logout",
  h(async (req, res) => {
    await auth.logout(readCookie(req, config.cookie.name));
    res.clearCookie(config.cookie.name, cookieOptions(null, req));
    res.json({ ok: true });
  })
);

export const adminRouter = Router();
adminRouter.get("/me", (req, res) => res.json({ admin: auth.publicAdmin(req.admin) }));
adminRouter.post("/me/password", h(async (req, res) => sendSession(req, res, await auth.changeOwnPassword(req.admin._id, req.body))));

adminRouter.get("/admins", h(async (_req, res) => res.json(await auth.listAdmins())));
adminRouter.post("/admins", h(async (req, res) => res.status(201).json(await auth.createAdmin(req.body))));
adminRouter.put("/admins/:id/password", h(async (req, res) => res.json(await auth.resetAdminPassword(req.admin._id, req.params.id, req.body))));
adminRouter.delete(
  "/admins/:id",
  h(async (req, res) => {
    await auth.deleteAdmin(req.admin._id, req.params.id);
    res.json({ ok: true });
  })
);
