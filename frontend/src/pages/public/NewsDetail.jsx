import { Link, useParams } from "react-router-dom";
import NewsCard from "../../components/NewsCard.jsx";
import SaveNewsButton from "../../components/SaveNewsButton.jsx";
import { Status } from "../../components/Status.jsx";
import { api } from "../../services/api.js";
import { newsImage } from "../../services/newsImage.js";
import { useAsync } from "../../services/useAsync.js";

export default function NewsDetail() {
  const { slug } = useParams();
  const { data, loading, error } = useAsync(() => api.newsDetail(slug), [slug]);

  if (loading || error || !data) {
    return (
      <main className="page">
        <Link className="text-link" to="/news">Back to news</Link>
        <Status loading={loading} error={error} empty={!data} emptyText="News not found." />
      </main>
    );
  }

  const { news, related } = data;
  return (
    <main className="page">
      <Link className="text-link" to="/news">Back to news</Link>
      <section className="detail-layout">
        <img className="detail-media" src={newsImage(news).src} alt="" />
        <article className="detail-copy">
          <span className="eyebrow">{news.category} · {news.level}</span>
          <h1>{news.title}</h1>
          {news.publishedAt && <p className="date">{new Date(news.publishedAt).toLocaleDateString()}</p>}
          <p className="prewrap">{news.fullDescription}</p>
          <div className="hero-actions">
            {news.attachmentUrl && <a className="button" href={news.attachmentUrl} target="_blank" rel="noreferrer">Download Notice</a>}
            {news.externalLink && <a className="button secondary" href={news.externalLink} target="_blank" rel="noreferrer">Open Link</a>}
            <Link className="button notify-detail" to="/profile#notifications">Notify Me</Link>
            <SaveNewsButton item={news} />
          </div>
        </article>
      </section>
      {related.length > 0 && (
        <section>
          <h2>Related updates</h2>
          <div className="card-grid">
            {related.map((item) => <NewsCard key={item._id} item={item} />)}
          </div>
        </section>
      )}
    </main>
  );
}
