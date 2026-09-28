import DownloadLink from "../../components/DownloadLink.jsx";
import { Status } from "../../components/Status.jsx";
import { api } from "../../services/api.js";
import { useAsync } from "../../services/useAsync.js";

export default function Results() {
  const { data, loading, error } = useAsync(() => api.results());
  const results = data || [];

  return (
    <main className="page">
      <div className="page-title">
        <h1>Olympiad Results</h1>
        <p>Download merit lists, round scores and finalist shortlists.</p>
      </div>
      <Status loading={loading} error={error} empty={!results.length} emptyText="No results published yet." />
      <div className="table-list">
        {results.map((result) => (
          <div className="table-row" key={result._id}>
            <div>
              <strong>{result.title}</strong>
              <span>{[result.level, result.year, result.session].filter(Boolean).join(" · ")}</span>
              {result.description && <span>{result.description}</span>}
            </div>
            <DownloadLink item={result} />
          </div>
        ))}
      </div>
    </main>
  );
}
