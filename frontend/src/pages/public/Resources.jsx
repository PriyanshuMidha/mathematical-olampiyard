import DownloadLink from "../../components/DownloadLink.jsx";
import { Status } from "../../components/Status.jsx";
import { api } from "../../services/api.js";
import { useAsync } from "../../services/useAsync.js";

export default function Resources() {
  const { data, loading, error } = useAsync(() => api.resources());
  const resources = data || [];

  return (
    <main className="page">
      <div className="page-title">
        <h1>Study Resources</h1>
        <p>Syllabus, sample papers, previous papers, formula sheets and answer keys.</p>
      </div>
      <Status loading={loading} error={error} empty={!resources.length} emptyText="No resources published yet." />
      <div className="resource-grid">
        {resources.map((resource) => (
          <article className="resource-card" key={resource._id}>
            <span>{resource.type}</span>
            <h3>{resource.title}</h3>
            <p>{resource.level}</p>
            {resource.description && <p className="muted">{resource.description}</p>}
            <DownloadLink item={resource} />
          </article>
        ))}
      </div>
    </main>
  );
}
