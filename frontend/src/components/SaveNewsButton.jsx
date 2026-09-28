import { useEffect, useState } from "react";
import { isSaved, toggleSavedNews } from "../services/savedNews.js";

export default function SaveNewsButton({ item, type = "news", small = false }) {
  const [saved, setSaved] = useState(() => isSaved(item, type));

  useEffect(() => {
    const update = () => setSaved(isSaved(item, type));
    update();
    window.addEventListener("saved-news-changed", update);
    return () => window.removeEventListener("saved-news-changed", update);
  }, [item, type]);

  function click(event) {
    event.preventDefault();
    event.stopPropagation();
    setSaved(toggleSavedNews(item, type));
  }

  return (
    <button type="button" className={small ? "save-btn small" : "save-btn"} onClick={click} aria-pressed={saved}>
      {saved ? "Saved" : "Save"}
    </button>
  );
}
