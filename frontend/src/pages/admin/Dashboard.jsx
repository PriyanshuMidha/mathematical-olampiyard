import { useState } from "react";
import { Link } from "react-router-dom";
import { Status } from "../../components/Status.jsx";
import { api } from "../../services/api.js";
import { useAsync } from "../../services/useAsync.js";

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i >= 3 ? 2 : 0)} ${units[i]}`;
}

const JOB_LABELS = {
  "storage-reconcile": "Recount Cloudflare storage",
  "orphan-file-cleanup": "Delete unused uploaded files"
};

function SystemPanel() {
  const { data, error, reload } = useAsync(() => api.system());
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  if (error) return <p className="empty error">{error}</p>;
  if (!data) return null;
  const { storage, jobs, email } = data;

  async function run(name) {
    setBusy(name);
    setMessage("");
    try {
      const { result } = await api.runJob(name);
      setMessage(`${JOB_LABELS[name] || name}: ${JSON.stringify(result)}`);
      await reload();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy("");
    }
  }

  const level = storage.percent >= 95 ? "danger" : storage.percent >= 80 ? "warn" : "";
  return (
    <div className="system-grid">
      <div className="metric">
        <span>File storage</span>
        {storage.driver === "r2" ? (
          <>
            <strong className="storage-figure">{formatBytes(storage.usedBytes)} <small>of {formatBytes(storage.limitBytes)}</small></strong>
            <div className={`meter ${level}`} role="meter" aria-valuenow={storage.percent} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${storage.percent}%` }} />
            </div>
            <small className="muted">
              {storage.percent}% used{storage.objects != null ? ` · ${storage.objects} files` : ""}
              {level === "danger" ? " · new uploads will be refused when full" : ""}
            </small>
          </>
        ) : (
          <small className="muted">Local disk (Cloudflare R2 not configured yet — add the R2_* settings to enable the 9.5 GB cloud storage).</small>
        )}
      </div>
      {email && (
        <div className="metric">
          <span>Email notifications</span>
          <strong className="storage-figure">{email.configured ? email.provider : "Not set up"}</strong>
          <small className="muted">
            {email.configured ? <>From: {email.from}{email.replyTo ? ` · replies to ${email.replyTo}` : ""}</> : "Add SMTP_* settings in backend/.env to send emails."}
          </small>
          <small className="muted">
            Sent today: {email.sentToday}{email.dailyLimit ? ` of ${email.dailyLimit}` : ""} · queued: {email.queued} · sending: {email.sending}
          </small>
          <small className="muted">
            Background sender: {email.worker.started ? `running (checks every ${email.worker.pollSeconds}s${email.worker.lastCheckAt ? `, last ${new Date(email.worker.lastCheckAt).toLocaleTimeString()}` : ""})` : "stopped"}
          </small>
          {email.lastJob?.lastError && <small className="error">Last job: {email.lastJob.lastError}</small>}
        </div>
      )}
      <div className="metric">
        <span>Scheduled jobs</span>
        <div className="job-list">
          {jobs.map((job) => (
            <div className="job" key={job.name}>
              <div>
                <strong>{JOB_LABELS[job.name] || job.name}</strong>
                <small className="muted">
                  every {job.everyMinutes >= 60 ? `${Math.round(job.everyMinutes / 60)} h` : `${job.everyMinutes} min`} ·{" "}
                  {job.lastRunAt ? `last run ${new Date(job.lastRunAt).toLocaleString()}` : "not run yet"}
                  {job.lastError ? ` · error: ${job.lastError}` : ""}
                </small>
              </div>
              <button className="ghost-dark small-btn" disabled={Boolean(busy)} onClick={() => run(job.name)}>
                {busy === job.name ? "Running..." : "Run now"}
              </button>
            </div>
          ))}
        </div>
        {message && <small className="muted">{message}</small>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data, loading, error } = useAsync(() => api.dashboard());

  const metrics = [
    ["Total News", data?.newsCount || 0],
    ["Drafts", data?.draftCount || 0],
    ["Current Notices", data?.currentCount || 0],
    ["Results", data?.resultCount || 0],
    ["Resources", data?.resourceCount || 0],
    ["Active Users", data?.subscriberCount || 0]
  ];

  return (
    <section>
      <div className="admin-heading">
        <div>
          <h1>Admin Dashboard</h1>
          <p>Manage current news, detailed pages, results, resources and users.</p>
        </div>
        <Link className="button" to="/admin/news/new">Add Current News</Link>
      </div>
      <Status loading={loading} error={error} />
      <div className="metric-grid">
        {metrics.map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <SystemPanel />
      <h2>Recent news</h2>
      <div className="table-list">
        {(data?.recentNews || []).map((item) => (
          <div className="table-row" key={item._id}>
            <div><strong>{item.title}</strong><span>{item.level} · {item.category}</span></div>
            <div className="row-actions">
              <span className={item.status === "published" ? "status published" : "status"}>{item.status}</span>
              <Link className="button small" to={`/admin/news/${item._id}/edit`}>Edit</Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
