import helmet from "helmet";

// Standard security headers (nosniff, frame-ancestors, HSTS in production, no X-Powered-By, ...).
// crossOriginResourcePolicy is relaxed so the separately hosted frontend can load uploaded images.
export const securityHeaders = helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
});

// Uploaded files are user-supplied: forbid them from running scripts or being framed if opened directly.
export function uploadHeaders(res) {
  // (File extensions are derived from the validated MIME type on upload, so nothing is ever served as HTML.)
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader("X-Content-Type-Options", "nosniff");
}
