// The real session is an httpOnly cookie set by the API (JavaScript can't read or steal it).
// This only stores a non-secret hint (name + expiry) so the UI knows whether to show admin pages;
// the backend still checks the cookie on every request and a 401 logs the UI out.
const SESSION_KEY = "adminSession";

function read() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

export function saveSession({ admin, expiresAt }) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ name: admin?.name, email: admin?.email, expiresAt }));
  } catch {
    /* storage unavailable: the cookie still works for this tab */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("adminToken"); // left over from the old token-based login
  } catch {
    /* ignore */
  }
}

export function currentSession() {
  const session = read();
  return session && session.expiresAt > Date.now() ? session : null;
}

export function hasSession() {
  return Boolean(currentSession());
}
