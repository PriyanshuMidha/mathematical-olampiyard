import { Link } from "react-router-dom";
import { newsImage } from "../services/newsImage.js";
import SaveNewsButton from "./SaveNewsButton.jsx";

export default function NewsCard({ item }) {
  return (
    <article className="news-card">
      <img className="card-media" src={newsImage(item).src} alt="" loading="lazy" decoding="async" />
      <div className="card-body">
        <div className="meta">{item.category} · {item.level}</div>
        <h3>{item.title}</h3>
        <p>{item.shortDescription}</p>
        <div className="card-actions">
          <Link to={`/news/${item.slug}`} className="text-link">View details</Link>
          <SaveNewsButton item={item} small />
        </div>
      </div>
    </article>
  );
}
