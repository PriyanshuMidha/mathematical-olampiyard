import { useState } from "react";
import { Status } from "../../components/Status.jsx";
import { api } from "../../services/api.js";
import { useAsync } from "../../services/useAsync.js";
import { useMeta } from "../../services/useMeta.js";
import { useTaxonomies } from "../../services/useTaxonomies.js";

export function ResultsAdmin() {
  return (
    <ContentManager
      title="Manage Results"
      description="Merit lists, round scores and shortlists shown on the public Results page."
      load={api.adminResults}
      create={api.createResult}
      update={api.updateResult}
      remove={api.deleteResult}
      empty={{ title: "", level: "", year: new Date().getFullYear(), session: "", description: "", externalLink: "", status: "published" }}
      summary={(item) => [item.level, item.year, item.session, item.status].filter(Boolean).join(" · ")}
      renderFields={(form, update, { levels }) => (
        <div className="form-grid">
          <label>Level<LevelSelect value={form.level} levels={levels} onChange={(v) => update("level", v)} /></label>
          <label>Year<input type="number" min="2000" max="2100" value={form.year} onChange={(e) => update("year", e.target.value)} required /></label>
          <label>Session / Round<input value={form.session} onChange={(e) => update("session", e.target.value)} placeholder="Round 1" /></label>
        </div>
      )}
    />
  );
}

export function ResourcesAdmin() {
  const { resourceTypes } = useMeta();
  return (
    <ContentManager
      title="Manage Resources"
      description="Syllabus, sample papers and study material shown on the public Resources page."
      load={api.adminResources}
      create={api.createResource}
      update={api.updateResource}
      remove={api.deleteResource}
      empty={{ title: "", type: resourceTypes[0], level: "", description: "", externalLink: "", status: "published" }}
      summary={(item) => [item.type, item.level, item.status].filter(Boolean).join(" · ")}
      renderFields={(form, update, { levels }) => (
        <div className="form-grid two">
          <label>Type<select value={form.type} onChange={(e) => update("type", e.target.value)}>{resourceTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>Level<LevelSelect value={form.level} levels={levels} onChange={(v) => update("level", v)} /></label>
        </div>
      )}
    />
  );
}

function LevelSelect({ value, levels, onChange }) {
  const options = value && !levels.includes(value) ? [...levels, value] : levels;
  return (
    <select value={value || levels[0] || ""} onChange={(e) => onChange(e.target.value)}>
      {options.map((l) => <option key={l}>{l}</option>)}
    </select>
  );
}

function ContentManager({ title, description, load, create, update, remove, empty, summary, renderFields }) {
  const taxonomies = useTaxonomies();
  const { data, loading, error, reload } = useAsync(() => load());
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const items = data || [];

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function reset() {
    setForm(empty);
    setFile(null);
    setEditingId(null);
    setFileKey((k) => k + 1);
  }

  function startEdit(item) {
    setEditingId(item._id);
    setForm(Object.fromEntries(Object.keys(empty).map((key) => [key, item[key] ?? empty[key]])));
    setFile(null);
    setFileKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event) {
    event.preventDefault();
    setFormError("");
    setBusy(true);
    try {
      const payload = { ...form, level: form.level || taxonomies.levels[0] };
      if (file) payload.file = file;
      if (editingId) await update(editingId, payload);
      else await create(payload);
      reset();
      await reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    setFormError("");
    try {
      await remove(item._id);
      if (editingId === item._id) reset();
      await reload();
    } catch (err) {
      setFormError(err.message);
    }
  }

  const current = items.find((item) => item._id === editingId);

  return (
    <section>
      <div className="admin-heading">
        <div><h1>{title}</h1><p>{description}</p></div>
      </div>
      <form className="admin-form" onSubmit={submit}>
        <h2>{editingId ? "Edit item" : "Add new"}</h2>
        <label>Title<input value={form.title} onChange={(e) => setField("title", e.target.value)} required /></label>
        {renderFields(form, setField, taxonomies)}
        <label>Description<textarea value={form.description} onChange={(e) => setField("description", e.target.value)} /></label>
        <div className="form-grid">
          <label>
            File (PDF, Word, Excel, image)
            <input key={fileKey} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={(e) => setFile(e.target.files[0] || null)} />
            {current?.fileUrl && <a className="text-link" href={current.fileUrl} target="_blank" rel="noreferrer">Current file</a>}
          </label>
          <label>Or external link<input type="url" value={form.externalLink} onChange={(e) => setField("externalLink", e.target.value)} placeholder="https://..." /></label>
          <label>Status<select value={form.status} onChange={(e) => setField("status", e.target.value)}><option>published</option><option>draft</option></select></label>
        </div>
        {formError && <p className="error">{formError}</p>}
        <div className="row-actions">
          <button disabled={busy}>{busy ? "Saving..." : editingId ? "Save Changes" : "Add"}</button>
          {editingId && <button type="button" className="ghost-dark" onClick={reset}>Cancel</button>}
        </div>
      </form>
      <h2>All items</h2>
      <Status loading={loading} error={error} empty={!items.length} emptyText="Nothing added yet." />
      <div className="table-list">
        {items.map((item) => (
          <div className="table-row" key={item._id}>
            <div><strong>{item.title}</strong><span>{summary(item)}</span></div>
            <div className="row-actions">
              {(item.fileUrl || item.externalLink) && (
                <a className="text-link" href={item.fileUrl || item.externalLink} target="_blank" rel="noreferrer">Open</a>
              )}
              <button className="button small" onClick={() => startEdit(item)}>Edit</button>
              <button className="danger" onClick={() => handleDelete(item)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const EMPTY_USER = { name: "", email: "", preference: "All updates" };

function toCsv(rows) {
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = ["name", "email", "preference", "active", "addedAt"];
  const lines = rows.map((r) => [r.name, r.email, r.preference, r.active, r.createdAt].map(escape).join(","));
  return [header.join(","), ...lines].join("\n");
}

// Users receive the news email notifications. Admin adds them here (there is no public sign-up form).
export function UsersAdmin() {
  const { userPreferences } = useMeta();
  const { data, loading, error, reload } = useAsync(() => api.users());
  const [form, setForm] = useState(EMPTY_USER);
  const [editingId, setEditingId] = useState(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const items = data || [];

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function reset() {
    setForm(EMPTY_USER);
    setEditingId(null);
  }

  function startEdit(item) {
    setEditingId(item._id);
    setForm({ name: item.name || "", email: item.email, preference: item.preference });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event) {
    event.preventDefault();
    setFormError("");
    setBusy(true);
    try {
      if (editingId) await api.updateUser(editingId, form);
      else await api.createUser(form);
      reset();
      await reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item) {
    setFormError("");
    try {
      await api.updateUser(item._id, { active: !item.active });
      await reload();
    } catch (err) {
      setFormError(err.message);
    }
  }

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([toCsv(items)], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <div className="admin-heading">
        <div>
          <h1>Users</h1>
          <p>People who get news email notifications. {items.filter((i) => i.active).length} active of {items.length} total.</p>
        </div>
        <button onClick={exportCsv} disabled={!items.length}>Export CSV</button>
      </div>
      <form className="admin-form" onSubmit={submit}>
        <h2>{editingId ? "Edit user" : "Add user"}</h2>
        <div className="form-grid">
          <label>Name<input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Full name" required /></label>
          <label>Email<input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} placeholder="name@email.com" required /></label>
          <label>
            Notifications
            <select value={form.preference} onChange={(e) => setField("preference", e.target.value)}>
              {userPreferences.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
        </div>
        {formError && <p className="error">{formError}</p>}
        <div className="row-actions">
          <button disabled={busy}>{busy ? "Saving..." : editingId ? "Save Changes" : "Add User"}</button>
          {editingId && <button type="button" className="ghost-dark" onClick={reset}>Cancel</button>}
        </div>
      </form>
      <h2>All users</h2>
      <Status loading={loading} error={error} empty={!items.length} emptyText="No users yet. Add the first one above." />
      <div className="table-list">
        {items.map((item) => (
          <div className="table-row" key={item._id}>
            <div>
              <strong>{item.name || item.email}</strong>
              <span>{item.email} · {item.preference} · {item.active ? "active" : "inactive"}</span>
            </div>
            <div className="row-actions">
              <button className="button small" onClick={() => startEdit(item)}>Edit</button>
              <button className={item.active ? "danger" : "button small"} onClick={() => toggle(item)}>
                {item.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CategoriesAdmin() {
  const { data, loading, error, reload } = useAsync(() => api.taxonomies());
  const [name, setName] = useState("");
  const [type, setType] = useState("level");
  const [formError, setFormError] = useState("");
  const items = data || [];

  async function add(e) {
    e.preventDefault();
    setFormError("");
    try {
      await api.createTaxonomy({ name, type });
      setName("");
      await reload();
    } catch (err) {
      setFormError(err.message);
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete ${item.type} "${item.name}"?`)) return;
    setFormError("");
    try {
      await api.deleteTaxonomy(item._id);
      await reload();
    } catch (err) {
      setFormError(err.message);
    }
  }

  return (
    <section>
      <div className="admin-heading">
        <div>
          <h1>Categories and Levels</h1>
          <p>These lists drive the level/category options in news, results and resources, and the public filters.</p>
        </div>
      </div>
      <form className="inline-form" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Foundation or Registration" required />
        <select value={type} onChange={(e) => setType(e.target.value)}><option value="level">Level</option><option value="category">Category</option></select>
        <button>Add</button>
      </form>
      {formError && <p className="error">{formError}</p>}
      <Status loading={loading} error={error} empty={!items.length} emptyText="No levels or categories yet." />
      <div className="table-list">
        {items.map((item) => (
          <div className="table-row" key={item._id}>
            <div><strong>{item.name}</strong><span>{item.type}</span></div>
            <button className="danger" onClick={() => handleDelete(item)}>Delete</button>
          </div>
        ))}
      </div>
    </section>
  );
}
