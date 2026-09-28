import { Link } from "react-router-dom";
import { newsImage } from "../services/newsImage.js";
import SaveNewsButton from "./SaveNewsButton.jsx";

export default function NewsCard({ item }) {
  return (
    <article className="news-card">
      <Link to={`/news/${item.slug}`} className="news-card-link" aria-label={`Open ${item.title}`}>
        <img className="card-media" src={newsImage(item).src} alt="" loading="lazy" decoding="async" />
        <div className="card-body">
          <div className="meta">{item.category} · {item.level}</div>
          <h3>{item.title}</h3>
          <p>{item.shortDescription}</p>
          <span className="text-link">View details</span>
        </div>
      </Link>
      <div className="card-save-action">
        <SaveNewsButton item={item} small />
      </div>
    </article>
  );
}
