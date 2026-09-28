import { badRequest } from "./errors.js";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function pick(source = {}, fields) {
  const out = {};
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out;
}

export function toBool(value) {
  return value === true || value === "true" || value === "on" || value === "1";
}

// Only http(s) links or uploaded file paths are allowed, so values like "javascript:" can never reach an href.
export function assertSafeUrls(data, fields) {
  for (const field of fields) {
    const value = data[field];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string" || value.length > 2000 || !/^(https?:\/\/|\/uploads\/)/i.test(value.trim())) {
      throw badRequest(`${field} must be a link starting with http:// or https://`);
    }
    data[field] = value.trim();
  }
}

// Query-string strings only (arrays/objects from `?a[]=` or `?a[$ne]=` are ignored), trimmed and length-capped.
export function queryString(value, maxLength = 100) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function paging(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  return { limit, page, skip: (page - 1) * limit };
}
