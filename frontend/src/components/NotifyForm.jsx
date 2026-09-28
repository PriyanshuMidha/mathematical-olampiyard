import { useState } from "react";
import { api } from "../services/api.js";
import { useMeta } from "../services/useMeta.js";

export default function NotifyForm({ compact = false }) {
  const { preferences = ["All updates"] } = useMeta();
  const [email, setEmail] = useState("");
  const [preference, setPreference] = useState("All updates");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    setBusy(true);
    try {
      const result = await api.subscribe({ email, preference });
      setMessage(result.active ? "Notifications enabled." : "Saved.");
      setEmail("");
      setPreference("All updates");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={compact ? "notify-form compact" : "notify-form"} onSubmit={submit}>
      {!compact && <h2>Get news notifications</h2>}
      {!compact && <p className="muted">Enter your email to receive new Mathematical Olympiad updates when they are published.</p>}
      <div className="notify-row">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@email.com" required />
        {!compact && (
          <select value={preference} onChange={(e) => setPreference(e.target.value)}>
            {preferences.map((item) => <option key={item}>{item}</option>)}
          </select>
        )}
        <button disabled={busy}>{busy ? "..." : compact ? "Notify" : "Subscribe"}</button>
      </div>
      {compact && <input type="hidden" value={preference} readOnly />}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </form>
  );
}
