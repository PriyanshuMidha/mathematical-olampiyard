import { useEffect, useState } from "react";
import { api } from "./api.js";

// Fixed option lists owned by the backend (GET /api/meta). Fallbacks are used until it loads or if it fails.
const FALLBACK = {
  resourceTypes: ["Syllabus", "Sample Paper", "Previous Paper", "Formula Sheet", "Answer Key", "Guide"],
  userPreferences: ["All updates", "Results only", "Exam dates", "Resources"],
  maxUploadMb: 50,
  maxCloudUploadBytes: 9.5 * 1024 ** 3,
  cloudUploads: false
};

let cache = null;
let pending = null;

export function useMeta() {
  const [meta, setMeta] = useState(cache || FALLBACK);

  useEffect(() => {
    if (cache) return;
    pending ||= api.meta().then((data) => (cache = { ...FALLBACK, ...data }));
    let active = true;
    pending.then((data) => active && setMeta(data)).catch(() => {
      pending = null;
    });
    return () => {
      active = false;
    };
  }, []);

  return meta;
}
