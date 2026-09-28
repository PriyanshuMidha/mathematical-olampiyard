import { useEffect, useState } from "react";
import { isSaved, toggleSavedNews } from "../services/savedNews.js";

export default function SaveNewsButton({ item, small = false }) {
  const [saved, setSaved] = useState(() => isSaved(item.slug));

  useEffect(() => {
    const update = () => setSaved(isSaved(item.slug));
    update();
    window.addEventListener("saved-news-changed", update);
    return () => window.removeEventListener("saved-news-changed", update);
  }, [item.slug]);

  function click(event) {
    event.preventDefault();
    event.stopPropagation();
    setSaved(toggleSavedNews(item));
  }

  return (
    <button type="button" className={small ? "save-btn small" : "save-btn"} onClick={click} aria-pressed={saved}>
      {saved ? "Saved" : "Save"}
    </button>
  );
}
