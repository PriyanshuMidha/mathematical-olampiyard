import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../services/api.js";
import { useMeta } from "../../services/useMeta.js";
import { newsImage } from "../../services/newsImage.js";
import { useTaxonomies } from "../../services/useTaxonomies.js";

const initial = {
  title: "",
  slug: "",
  shortDescription: "",
  fullDescription: "",
  externalLink: "",
  level: "National",
  category: "Registration",
  status: "published",
  isCurrent: true,
  showOnHome: true,
  sendEmailNotification: false
};

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index < 2 ? 0 : 1)} ${units[index]}`;
}

async function uploadToCloudflare(file, onProgress, maxBytes) {
  if (file.size > maxBytes) {
    throw new Error(`Attachment is larger than the ${formatBytes(maxBytes)} Cloudflare limit.`);
  }

  // The server reserves the space first and refuses if the bucket's storage cap would be passed.
  const session = await api.startR2Upload({ fileName: file.name, fileType: file.type, fileSize: file.size });

  if (session.type === "direct") {
    try {
      const response = await fetch(session.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("Cloudflare upload failed.");
      onProgress(100);
      const done = await api.completeR2Upload({ key: session.key });
      return done.publicUrl;
    } catch (error) {
      // Gives the reserved storage back.
      await api.abortR2Upload({ key: session.key }).catch(() => null);
      throw error;
    }
  }

  const partSize = session.partSize;
  const totalParts = Math.ceil(file.size / partSize);
  const parts = [];

  try {
    for (let index = 0; index < totalParts; index += 1) {
      const partNumber = index + 1;
      const chunk = file.slice(index * partSize, Math.min(file.size, (index + 1) * partSize));
      const { uploadUrl } = await api.signR2Part({ key: session.key, uploadId: session.uploadId, partNumber });
      const response = await fetch(uploadUrl, { method: "PUT", body: chunk });
      if (!response.ok) throw new Error(`Cloudflare upload failed on part ${partNumber}`);
      parts.push({ PartNumber: partNumber, ETag: response.headers.get("ETag")?.replaceAll('"', "") });
      onProgress(Math.round((partNumber / totalParts) * 100));
    }
    const done = await api.completeR2Upload({ key: session.key, uploadId: session.uploadId, parts });
    return done.publicUrl;
  } catch (error) {
    await api.abortR2Upload({ key: session.key, uploadId: session.uploadId }).catch(() => null);
    throw error;
  }
}

const MB = 1024 * 1024;

// Unsaved work is kept in this tab (sessionStorage) so an expired session or accidental reload
// doesn't lose a long article. Cleared after a successful save.
function draftKey(id) {
  return `newsDraft:${id || "new"}`;
}
function readDraft(id) {
  try {
    return JSON.parse(sessionStorage.getItem(draftKey(id)) || "null");
  } catch {
    return null;
  }
}
function writeDraft(id, form) {
  try {
    sessionStorage.setItem(draftKey(id), JSON.stringify(form));
  } catch {
    /* storage unavailable: nothing to do */
  }
}
function clearDraft(id) {
  try {
    sessionStorage.removeItem(draftKey(id));
  } catch {
    /* ignore */
  }
}

export default function NewsForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { levels, categories } = useTaxonomies();
  const { maxCloudUploadBytes, maxUploadMb, cloudUploads } = useMeta();
  const [form, setForm] = useState(initial);
  const [files, setFiles] = useState({ image: null, attachment: null });
  const [existing, setExisting] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const dirty = useRef(false);
  // A big attachment already uploaded to Cloudflare is reused if saving fails and the admin retries.
  const cloudUpload = useRef({ file: null, url: "" });
  const navigate = useNavigate();

  useEffect(() => {
    if (isEdit) return;
    const draft = readDraft(id);
    if (draft) {
      setForm({ ...initial, ...draft });
      setDraftRestored(true);
    }
  }, [id, isEdit]);

  useEffect(() => {
    if (dirty.current) writeDraft(id, form);
  }, [id, form]);

  function discardDraft() {
    clearDraft(id);
    setDraftRestored(false);
    dirty.current = false;
    if (existing) setForm(Object.fromEntries(Object.keys(initial).map((key) => [key, existing[key] ?? initial[key]])));
    else setForm(initial);
  }

  useEffect(() => {
    if (!isEdit) return;
    api
      .adminNewsItem(id)
      .then((news) => {
        setExisting(news);
        const saved = Object.fromEntries(Object.keys(initial).map((key) => [key, news[key] ?? initial[key]]));
        const draft = readDraft(id);
        setForm(draft ? { ...saved, ...draft } : saved);
        if (draft) setDraftRestored(true);
      })
      .catch((err) => setError(err.message));
  }, [id, isEdit]);

  function update(field, value) {
    dirty.current = true;
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const payload = { ...form };
      if (files.image) payload.image = files.image;
      if (files.attachment) {
        // Normal uploads go through the API (limit MAX_UPLOAD_MB); larger ones straight to Cloudflare R2.
        const directLimit = Math.min(40, maxUploadMb) * MB;
        if (files.attachment.size <= directLimit) {
          payload.attachment = files.attachment;
        } else if (!cloudUploads) {
          throw new Error(`The attachment is larger than ${Math.round(directLimit / MB)} MB. Bigger files need Cloudflare R2 to be set up (see docs/SETUP.md).`);
        } else if (cloudUpload.current.file === files.attachment && cloudUpload.current.url) {
          payload.attachmentUrl = cloudUpload.current.url;
        } else {
          setUploadProgress(0);
          payload.attachmentUrl = await uploadToCloudflare(files.attachment, setUploadProgress, maxCloudUploadBytes);
          cloudUpload.current = { file: files.attachment, url: payload.attachmentUrl };
        }
      }
      if (!isEdit && !payload.slug) delete payload.slug;

      const response = isEdit ? await api.updateNews(id, payload) : await api.createNews(payload);
      const email = response.emailResult;
      let message = "News saved.";
      if (email?.queued) message = "News saved. Email notification is being sent in the background.";
      else if (email?.sent) message = `News saved. Email sent to ${email.sent} user(s).`;
      else if (email?.recipients) message = `News saved. Email skipped: SMTP not configured (${email.recipients} user(s)).`;
      else if (email?.error) message = `News saved, but ${email.error.toLowerCase()}.`;

      clearDraft(id);
      navigate("/admin/news", { state: { notice: message } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  const levelOptions = levels.includes(form.level) ? levels : [...levels, form.level];
  const categoryOptions = categories.includes(form.category) ? categories : [...categories, form.category];

  return (
    <section>
      <div className="admin-heading">
        <div>
          <h1>{isEdit ? "Edit News" : "Add Current News / Detail Page"}</h1>
          <p>Create the card shown on listing pages and the full detail page opened when users click it.</p>
        </div>
      </div>
      {draftRestored && (
        <p className="notice-bar">
          Restored your unsaved changes from earlier.{" "}
          <button type="button" className="ghost-dark small-btn" onClick={discardDraft}>Discard them</button>
        </p>
      )}
      <form className="admin-form" onSubmit={submit}>
        <label>News title<input value={form.title} onChange={(e) => update("title", e.target.value)} required /></label>
        {isEdit && (
          <label>
            URL slug
            <input value={form.slug} onChange={(e) => update("slug", e.target.value)} />
            <small className="muted">Changing this breaks links that were already shared or emailed.</small>
          </label>
        )}
        <label>Short summary<textarea value={form.shortDescription} onChange={(e) => update("shortDescription", e.target.value)} required /></label>
        <label>Full detail page content<textarea rows="7" value={form.fullDescription} onChange={(e) => update("fullDescription", e.target.value)} required /></label>
        <label>External link<input type="url" value={form.externalLink} onChange={(e) => update("externalLink", e.target.value)} placeholder="https://example.com/notice" /></label>
        <div className="form-grid">
          <label>Level<select value={form.level} onChange={(e) => update("level", e.target.value)}>{levelOptions.map((l) => <option key={l}>{l}</option>)}</select></label>
          <label>Category<select value={form.category} onChange={(e) => update("category", e.target.value)}>{categoryOptions.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Status<select value={form.status} onChange={(e) => update("status", e.target.value)}><option>published</option><option>draft</option></select></label>
        </div>
        <div className="form-grid two">
          <label>
            Image
            <input type="file" accept="image/*" onChange={(e) => setFiles((f) => ({ ...f, image: e.target.files[0] || null }))} />
            {existing?.imageUrl && <a className="text-link" href={existing.imageUrl} target="_blank" rel="noreferrer">Current image</a>}
            {!files.image && !existing?.imageUrl && (
              <span className="default-preview">
                <img src={newsImage(form).src} alt="" />
                <small className="muted">No image uploaded — this picture is shown (changes with level/category).</small>
              </span>
            )}
          </label>
          <label>
            Attachment (PDF, Word, Excel)
            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => setFiles((f) => ({ ...f, attachment: e.target.files[0] || null }))} />
            {files.attachment && <small className="muted">Selected: {files.attachment.name} ({formatBytes(files.attachment.size)})</small>}
            {existing?.attachmentUrl && <a className="text-link" href={existing.attachmentUrl} target="_blank" rel="noreferrer">Current attachment</a>}
          </label>
        </div>
        <div className="checks">
          <label><input type="checkbox" checked={form.isCurrent} onChange={(e) => update("isCurrent", e.target.checked)} /> Mark as current/latest</label>
          <label><input type="checkbox" checked={form.showOnHome} onChange={(e) => update("showOnHome", e.target.checked)} /> Show on home</label>
          <label>
            <input
              type="checkbox"
              checked={form.sendEmailNotification}
              disabled={Boolean(existing?.emailSentAt)}
              onChange={(e) => update("sendEmailNotification", e.target.checked)}
            />{" "}
            {existing?.emailSentAt ? `Email sent ${new Date(existing.emailSentAt).toLocaleString()}` : "Send email notification (when published)"}
          </label>
        </div>
        {uploadProgress !== null && <p className="muted">Uploading attachment to Cloudflare: {uploadProgress}%</p>}
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? "Saving..." : isEdit ? "Save Changes" : form.status === "published" ? "Publish News" : "Save Draft"}</button>
      </form>
    </section>
  );
}
