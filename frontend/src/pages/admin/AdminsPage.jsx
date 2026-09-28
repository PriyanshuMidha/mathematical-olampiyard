import { useState } from "react";
import { Status } from "../../components/Status.jsx";
import { api } from "../../services/api.js";
import { currentSession, saveSession } from "../../services/auth.js";
import { useAsync } from "../../services/useAsync.js";

const MIN_PASSWORD = 10;

function ChangeMyPassword() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (form.newPassword !== form.confirm) return setError("New passwords don't match");
    setBusy(true);
    try {
      const session = await api.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      saveSession(session);
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setMessage("Password changed. All other sessions have been logged out.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const field = (key, label, autoComplete) => (
    <label>
      {label}
      <input type="password" autoComplete={autoComplete} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} required minLength={key === "currentPassword" ? 1 : MIN_PASSWORD} />
    </label>
  );

  return (
    <form className="admin-form" onSubmit={submit}>
      <h2>Change my password</h2>
      <div className="form-grid">
        {field("currentPassword", "Current password", "current-password")}
        {field("newPassword", `New password (min ${MIN_PASSWORD})`, "new-password")}
        {field("confirm", "Confirm new password", "new-password")}
      </div>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      <div className="row-actions"><button disabled={busy}>{busy ? "Saving..." : "Change password"}</button></div>
    </form>
  );
}

export default function AdminsPage() {
  const me = currentSession();
  const { data, loading, error, reload } = useAsync(() => api.admins());
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const admins = data || [];

  async function run(action, successMessage) {
    setFormError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await reload();
    } catch (err) {
      setFormError(err.message);
    }
  }

  async function add(event) {
    event.preventDefault();
    setBusy(true);
    await run(async () => {
      await api.createAdmin(form);
      setForm({ name: "", email: "", password: "" });
    }, "Admin added.");
    setBusy(false);
  }

  function reset(admin) {
    const password = window.prompt(`New password for ${admin.email} (min ${MIN_PASSWORD} characters):`);
    if (!password) return;
    run(() => api.resetAdminPassword(admin.id, password), `Password reset for ${admin.email}. Their old sessions are logged out.`);
  }

  function remove(admin) {
    if (!window.confirm(`Remove admin "${admin.email}"? They will lose access immediately.`)) return;
    run(() => api.deleteAdmin(admin.id), `${admin.email} removed.`);
  }

  return (
    <section>
      <div className="admin-heading">
        <div>
          <h1>Admins &amp; Password</h1>
          <p>People who can log in to this CMS. Removing an admin or resetting a password ends their sessions immediately.</p>
        </div>
      </div>

      <ChangeMyPassword />

      <form className="admin-form" onSubmit={add} style={{ marginTop: 24 }}>
        <h2>Add admin</h2>
        <div className="form-grid">
          <label>Name<input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name" /></label>
          <label>Username or email<input value={form.email} autoComplete="off" onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required /></label>
          <label>Password (min {MIN_PASSWORD})<input type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required /></label>
        </div>
        {formError && <p className="error">{formError}</p>}
        {notice && <p className="success">{notice}</p>}
        <div className="row-actions"><button disabled={busy}>{busy ? "Adding..." : "Add admin"}</button></div>
      </form>

      <h2>All admins</h2>
      <Status loading={loading} error={error} empty={!admins.length} />
      <div className="table-list">
        {admins.map((admin) => {
          const isMe = admin.email === me?.email;
          return (
            <div className="table-row" key={admin.id}>
              <div>
                <strong>{admin.name}{isMe ? " (you)" : ""}</strong>
                <span>{admin.email}</span>
              </div>
              {!isMe && (
                <div className="row-actions">
                  <button className="ghost-dark" onClick={() => reset(admin)}>Reset password</button>
                  <button className="danger" onClick={() => remove(admin)}>Remove</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
