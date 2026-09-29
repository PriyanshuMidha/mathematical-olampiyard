import { clearSession } from "./auth.js";

// Defaults to the same host name as the page (localhost vs 127.0.0.1 matters: the session cookie is per site).
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
function apiBase() {
  const configured = import.meta.env.VITE_API_BASE;
  if (!configured) return `${window.location.protocol}//${window.location.hostname}:5001/api`;
  const url = new URL(configured);
  // localhost and 127.0.0.1 are different sites for cookies; follow whichever one the page uses.
  if (LOCAL_HOSTS.includes(url.hostname) && LOCAL_HOSTS.includes(window.location.hostname)) url.hostname = window.location.hostname;
  return url.toString().replace(/\/$/, "");
}
const API_BASE = apiBase();
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS || 15000);
// File uploads can take minutes on slow connections; aborting them early could make the admin retry
// while the first upload still completes on the server.
const UPLOAD_TIMEOUT_MS = 10 * 60_000;

async function rawRequest(path, options = {}) {
  const response = await request(path, options);
  return response;
}

async function request(path, options = {}) {
  const { skipUnauthorizedRedirect = false, ...fetchOptions } = options;
  const isForm = options.body instanceof FormData;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), isForm ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      // Sends the httpOnly session cookie. The custom header is the API's CSRF check.
      credentials: "include",
      headers: {
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        "X-Requested-With": "olympiad-cms",
        ...(options.headers || {})
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("API request timed out. Please check that the backend and MongoDB are connected.");
    }
    throw new Error("Cannot reach API. Please check that the backend server is running.");
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!skipUnauthorizedRedirect && response.status === 401 && path.startsWith("/admin") && path !== "/admin/login") {
    clearSession();
    window.location.assign("/admin/login?expired=1");
    throw new Error("Session expired. Please log in again.");
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Request failed (${response.status})`);
  }

  return response.json();
}

const json = (method, payload) => ({ method, body: JSON.stringify(payload) });

// Sends multipart when the payload contains a File, JSON otherwise.
function body(method, payload) {
  const hasFile = Object.values(payload).some((value) => value instanceof File);
  if (!hasFile) return json(method, payload);

  const form = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    form.append(key, value instanceof File ? value : String(value));
  }
  return { method, body: form };
}

export const api = {
  home: () => request("/home"),
  news: (params = "") => request(`/news${params}`),
  newsDetail: (slug) => request(`/news/${encodeURIComponent(slug)}`),
  results: () => request("/results"),
  resources: () => request("/resources"),
  publicTaxonomies: () => request("/taxonomies"),
  meta: () => request("/meta"),
  subscribe: (payload) => request("/subscribe", json("POST", payload)),

  adminLogin: (payload) => request("/admin/login", json("POST", payload)),
  adminLogout: () => request("/admin/logout", { method: "POST" }),
  me: (options = {}) => request("/admin/me", options),
  changePassword: (payload) => request("/admin/me/password", json("POST", payload)),
  admins: () => request("/admin/admins"),
  createAdmin: (payload) => request("/admin/admins", json("POST", payload)),
  resetAdminPassword: (id, password) => request(`/admin/admins/${id}/password`, json("PUT", { password })),
  deleteAdmin: (id) => request(`/admin/admins/${id}`, { method: "DELETE" }),
  dashboard: () => request("/admin/dashboard"),
  system: () => request("/admin/system"),
  runJob: (name) => request(`/admin/system/jobs/${encodeURIComponent(name)}/run`, { method: "POST" }),

  adminNews: () => request("/admin/news"),
  adminNewsItem: (id) => request(`/admin/news/${id}`),
  createNews: (payload) => request("/admin/news", body("POST", payload)),
  updateNews: (id, payload) => request(`/admin/news/${id}`, body("PUT", payload)),
  deleteNews: (id) => request(`/admin/news/${id}`, { method: "DELETE" }),

  startR2Upload: (payload) => request("/admin/uploads/r2/start", json("POST", payload)),
  signR2Part: (payload) => request("/admin/uploads/r2/sign-part", json("POST", payload)),
  completeR2Upload: (payload) => request("/admin/uploads/r2/complete", json("POST", payload)),
  abortR2Upload: (payload) => request("/admin/uploads/r2/abort", json("POST", payload)),

  adminResults: () => request("/admin/results"),
  createResult: (payload) => request("/admin/results", body("POST", payload)),
  updateResult: (id, payload) => request(`/admin/results/${id}`, body("PUT", payload)),
  deleteResult: (id) => request(`/admin/results/${id}`, { method: "DELETE" }),

  adminResources: () => request("/admin/resources"),
  createResource: (payload) => request("/admin/resources", body("POST", payload)),
  updateResource: (id, payload) => request(`/admin/resources/${id}`, body("PUT", payload)),
  deleteResource: (id) => request(`/admin/resources/${id}`, { method: "DELETE" }),

  users: () => request("/admin/users"),
  createUser: (payload) => request("/admin/users", json("POST", payload)),
  updateUser: (id, payload) => request(`/admin/users/${id}`, json("PUT", payload)),

  taxonomies: () => request("/admin/taxonomies"),
  createTaxonomy: (payload) => request("/admin/taxonomies", json("POST", payload)),
  deleteTaxonomy: (id) => request(`/admin/taxonomies/${id}`, { method: "DELETE" })
};
