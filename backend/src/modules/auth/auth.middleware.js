import { config } from "../../config/env.js";
import { readCookie } from "../../core/cookies.js";
import { verifyToken } from "./auth.service.js";

export async function requireAdmin(req, res, next) {
  const token = readCookie(req, config.cookie.name);
  if (!token) return res.status(401).json({ message: "Please log in" });

  let admin;
  try {
    admin = await verifyToken(token);
  } catch (_error) {
    admin = null;
  }
  if (!admin) return res.status(401).json({ message: "Session expired. Please log in again." });

  req.admin = admin;
  next();
}

// CSRF protection for cookie-authenticated admin requests.
// Browsers can't add a custom header to a cross-site form/image request, and a cross-origin fetch
// with one needs a CORS preflight that only CLIENT_URL origins pass. The Origin check is a second layer.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export function requireSameOriginWrite(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get("X-Requested-With") !== "olympiad-cms") {
    return res.status(403).json({ message: "Missing request header" });
  }
  const origin = req.get("Origin");
  if (origin && !config.clientUrls.includes(origin) && origin !== config.apiUrl) {
    return res.status(403).json({ message: "Origin not allowed" });
  }
  next();
}
