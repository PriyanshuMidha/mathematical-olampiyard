import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../services/api.js";
import { hasSession, saveSession } from "../../services/auth.js";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  if (hasSession()) return <Navigate to="/admin" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await api.adminLogin({ email: username, password });
      saveSession(response);
      navigate("/admin");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Admin Login</h1>
        <p>Only administrators can manage Olympiad news, details, results and resources.</p>
        {searchParams.get("expired") && <p className="error">Your session expired. Please log in again.</p>}
        <label>Username<input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? "Logging in..." : "Login"}</button>
        <Link className="text-link login-back" to="/">Back to Main Page</Link>
      </form>
    </main>
  );
}
