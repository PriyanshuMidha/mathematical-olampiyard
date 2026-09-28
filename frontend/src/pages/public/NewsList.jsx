import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import NewsCard from "../../components/NewsCard.jsx";
import { Status } from "../../components/Status.jsx";
import { api } from "../../services/api.js";
import { useTaxonomies } from "../../services/useTaxonomies.js";

const PAGE_SIZE = 24;

export default function NewsList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { levels, categories } = useTaxonomies();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const level = searchParams.get("level") || "";
  const category = searchParams.get("category") || "";
  const queryString = searchParams.toString();

  const [news, setNews] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // The API returns news in pages; "Load more" appends the next page. Filters reset to page 1.
  useEffect(() => setPage(1), [queryString]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(queryString);
    params.set("limit", String(PAGE_SIZE));
    params.set("page", String(page));
    setLoading(true);
    setError("");
    api
      .news(`?${params}`)
      .then((items) => {
        if (!active) return;
        setNews((current) => (page === 1 ? items : [...current, ...items]));
        setHasMore(items.length === PAGE_SIZE);
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [queryString, page]);

  function setParam(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  return (
    <main className="page">
      <div className="page-title">
        <h1>Latest News</h1>
        <p>Filter current notices by Olympiad level and category.</p>
      </div>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          setParam("q", query.trim());
        }}
      >
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search news" />
        <select value={category} onChange={(event) => setParam("category", event.target.value)}>
          <option value="">All categories</option>
          {categories.map((item) => <option key={item}>{item}</option>)}
        </select>
        <button>Search</button>
      </form>
      <div className="chips">
        {["", ...levels].map((item) => (
          <button key={item || "all"} className={item === level ? "active" : ""} onClick={() => setParam("level", item)}>
            {item || "All"}
          </button>
        ))}
      </div>
      <Status loading={loading && page === 1} error={error} empty={!loading && !news.length} emptyText="No news matches these filters." />
      <div className="card-grid wide">
        {news.map((item) => <NewsCard key={item._id} item={item} />)}
      </div>
      {hasMore && (
        <div className="load-more">
          <button className="ghost-dark" disabled={loading} onClick={() => setPage((p) => p + 1)}>
            {loading ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </main>
  );
}
