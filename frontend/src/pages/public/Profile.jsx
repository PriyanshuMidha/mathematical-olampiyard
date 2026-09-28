import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import NewsCard from "../../components/NewsCard.jsx";
import { currentSession } from "../../services/auth.js";
import { removeSavedNews, savedNews } from "../../services/savedNews.js";

export default function Profile() {
  const [items, setItems] = useState(() => savedNews());
  const session = currentSession();

  useEffect(() => {
    const update = () => setItems(savedNews());
    window.addEventListener("saved-news-changed", update);
    return () => window.removeEventListener("saved-news-changed", update);
  }, []);

  function remove(slug) {
    removeSavedNews(slug);
    setItems(savedNews());
  }

  return (
    <main className="page profile-page">
      <div className="page-title profile-heading">
        <div>
          <h1>Profile</h1>
          <p>Save Olympiad news in this browser and access admin tools when you are signed in.</p>
        </div>
        <div className="row-actions">
          <Link className="button secondary" to="/">Main Page</Link>
          {session ? <Link className="button" to="/admin">Admin Dashboard</Link> : <Link className="button" to="/admin/login">Admin Login</Link>}
        </div>
      </div>

      <section className="profile-panel">
        <h2>{session ? "Admin Access" : "Admin Login"}</h2>
        {session ? (
          <p className="muted">Signed in as {session.name || session.email}. Use the dashboard to add news, results, resources and users.</p>
        ) : (
          <p className="muted">Administrators can log in here. Students can still save news below without logging in.</p>
        )}
      </section>

      <section>
        <div className="section-heading">
          <h2>Saved News</h2>
          <Link className="text-link" to="/news">Browse news</Link>
        </div>
        {!items.length ? (
          <p className="empty">No saved news yet. Open any news item and press Save.</p>
        ) : (
          <div className="card-grid wide">
            {items.map((item) => (
              <div className="saved-card" key={item.slug}>
                <NewsCard item={item} />
                <button className="ghost-dark remove-saved" onClick={() => remove(item.slug)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
