import { Link } from "react-router-dom";
import NewsCard from "../../components/NewsCard.jsx";
import { Status } from "../../components/Status.jsx";
import { api } from "../../services/api.js";
import { useAsync } from "../../services/useAsync.js";

export default function Home() {
  const { data, loading, error } = useAsync(() => api.home());
  const latest = data?.latestNews || [];
  const current = data?.currentNews || [];
  const results = data?.results || [];
  const resources = data?.resources || [];

  return (
    <main>
      <section className="hero">
        <div>
          <span className="eyebrow">Current Olympiad updates</span>
          <h1>Mathematical Olympiad News, Results and Resources</h1>
          <p>Get registration alerts, exam dates, results, sample papers and preparation updates for every Olympiad level.</p>
          <div className="hero-actions">
            <Link className="button" to="/news">View Latest News</Link>
            <Link className="button secondary" to="/resources">Study Resources</Link>
          </div>
        </div>
        <div className="formula-panel">
          <strong>x² + y² = z²</strong>
          <span>Foundation · Junior · Senior · National · International</span>
        </div>
      </section>

      {current.length > 0 && (
        <section className="section-grid">
          <div className="section-heading">
            <h2>Current Notices</h2>
            <Link to="/news?current=true">See all</Link>
          </div>
          <div className="notice-list">
            {current.map((item) => (
              <Link key={item._id} className="notice" to={`/news/${item.slug}`}>
                <span className="meta">{item.category}</span>
                <strong>{item.title}</strong>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section-grid">
        <div>
          <div className="section-heading">
            <h2>Latest Olympiad Updates</h2>
            <Link to="/news">See all</Link>
          </div>
          <Status loading={loading} error={error} empty={!latest.length} emptyText="No updates published yet." />
          <div className="card-grid">
            {latest.slice(0, 4).map((item) => <NewsCard key={item._id} item={item} />)}
          </div>
        </div>
      </section>

      {(results.length > 0 || resources.length > 0) && (
        <section className="section-grid two-equal">
          <div>
            <div className="section-heading">
              <h2>Recent Results</h2>
              <Link to="/results">See all</Link>
            </div>
            <div className="table-list">
              {results.map((result) => (
                <div className="table-row" key={result._id}>
                  <div>
                    <strong>{result.title}</strong>
                    <span>{result.level} · {result.year}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="section-heading">
              <h2>New Resources</h2>
              <Link to="/resources">See all</Link>
            </div>
            <div className="table-list">
              {resources.map((resource) => (
                <div className="table-row" key={resource._id}>
                  <div>
                    <strong>{resource.title}</strong>
                    <span>{resource.type} · {resource.level}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
