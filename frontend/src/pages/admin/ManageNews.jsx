import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Status } from "../../components/Status.jsx";
import { api } from "../../services/api.js";
import { useAsync } from "../../services/useAsync.js";

export default function ManageNews() {
  const location = useLocation();
  const { data, loading, error, reload } = useAsync(() => api.adminNews());
  const [actionError, setActionError] = useState("");
  const news = data || [];

  async function run(action) {
    setActionError("");
    try {
      await action();
      await reload();
    } catch (err) {
      setActionError(err.message);
    }
  }

  function remove(item) {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    run(() => api.deleteNews(item._id));
  }

  function toggleStatus(item) {
    run(() => api.updateNews(item._id, { status: item.status === "published" ? "draft" : "published" }));
  }

  return (
    <section>
      <div className="admin-heading">
        <div><h1>Manage News</h1><p>Edit, delete, publish, draft and control homepage/current status.</p></div>
        <Link className="button" to="/admin/news/new">Add News</Link>
      </div>
      {location.state?.notice && <p className="success">{location.state.notice}</p>}
      {actionError && <p className="error">{actionError}</p>}
      <Status loading={loading} error={error} empty={!news.length} emptyText="No news yet." />
      <div className="table-list">
        {news.map((item) => (
          <div className="table-row" key={item._id}>
            <div>
              <strong>{item.title}</strong>
              <span>
                {item.level} · {item.category} · {item.status}
                {item.isCurrent ? " · current" : ""}
                {item.showOnHome ? " · home" : ""}
              </span>
            </div>
            <div className="row-actions">
              {item.status === "published" && <a className="text-link" href={`/news/${item.slug}`} target="_blank" rel="noreferrer">View</a>}
              <button className="ghost-dark" onClick={() => toggleStatus(item)}>{item.status === "published" ? "Unpublish" : "Publish"}</button>
              <Link className="button small" to={`/admin/news/${item._id}/edit`}>Edit</Link>
              <button className="danger" onClick={() => remove(item)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
