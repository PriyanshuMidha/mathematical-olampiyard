import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import { clearSession, currentSession } from "../services/auth.js";

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  // On phones the sidebar collapses into a top bar with a Menu button.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname]);

  async function logout() {
    await api.adminLogout().catch(() => {});
    clearSession();
    navigate("/admin/login");
  }

  return (
    <div className="admin-shell">
      <aside className={menuOpen ? "admin-sidebar open" : "admin-sidebar"}>
        <div className="admin-topbar">
          <h2>Olympiad CMS</h2>
          <button className="menu-toggle" aria-expanded={menuOpen} aria-controls="admin-nav" onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
        <nav id="admin-nav" className="admin-nav">
        {currentSession()?.name && <span className="muted">Signed in as {currentSession().name}</span>}
        <NavLink to="/admin" end>Dashboard</NavLink>
        <NavLink to="/admin/news/new">Add Current News</NavLink>
        <NavLink to="/admin/news" end>Manage News</NavLink>
        <NavLink to="/admin/results">Results</NavLink>
        <NavLink to="/admin/resources">Resources</NavLink>
        <NavLink to="/admin/users">Users</NavLink>
        <NavLink to="/admin/categories">Categories</NavLink>
        <NavLink to="/admin/admins">Admins &amp; Password</NavLink>
        <button className="ghost" onClick={logout}>Logout</button>
        </nav>
      </aside>
      <main className="admin-main">
        <Suspense fallback={<p className="empty">Loading...</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
