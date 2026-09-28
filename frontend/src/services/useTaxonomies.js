import { useEffect, useState } from "react";
import { api } from "./api.js";

const FALLBACK = {
  levels: ["Foundation", "Junior", "Senior", "National", "International"],
  categories: ["Registration", "Exam Date", "Result", "Syllabus", "Sample Paper", "Important Notice", "General"]
};

// Levels and categories managed in Admin → Categories. Falls back to defaults if none exist yet.
export function useTaxonomies() {
  const [state, setState] = useState(FALLBACK);

  useEffect(() => {
    api
      .publicTaxonomies()
      .then((items) => {
        const levels = items.filter((i) => i.type === "level").map((i) => i.name);
        const categories = items.filter((i) => i.type === "category").map((i) => i.name);
        setState({
          levels: levels.length ? levels : FALLBACK.levels,
          categories: categories.length ? categories : FALLBACK.categories
        });
      })
      .catch(() => {});
  }, []);

  return state;
}
