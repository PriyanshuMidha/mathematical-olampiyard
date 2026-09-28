import { NavLink, Outlet } from "react-router-dom";

export default function PublicLayout() {
  return (
    <div className="site-shell">
      <header className="public-header">
        <NavLink to="/" className="brand">Mathematical Olympiad</NavLink>
        <nav>
          <NavLink to="/">Home</NavLink>
          <NavLink to="/news">Latest News</NavLink>
          <NavLink to="/results">Results</NavLink>
          <NavLink to="/resources">Resources</NavLink>
          <NavLink to="/about">About</NavLink>
          <NavLink to="/contact">Contact</NavLink>
        </nav>
        <NavLink to="/profile" className="admin-access">Profile</NavLink>
      </header>
      <Outlet />
      <footer className="footer">
        <span>Mathematical Olympiad</span>
        <span>News, results, exam dates, and resources.</span>
      </footer>
    </div>
  );
}
