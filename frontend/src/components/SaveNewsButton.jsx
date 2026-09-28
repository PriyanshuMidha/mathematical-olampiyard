import { useEffect, useState } from "react";
import { isSaved, toggleSavedNews } from "../services/savedNews.js";

export default function SaveNewsButton({ item, type = "news", small = false }) {
  const [saved, setSaved] = useState(() => isSaved(item, type));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const update = () => setSaved(isSaved(item, type));
    update();
    window.addEventListener("saved-news-changed", update);
    return () => window.removeEventListener("saved-news-changed", update);
  }, [item, type]);

  function click(event) {
    event.preventDefault();
    event.stopPropagation();
    const result = toggleSavedNews(item, type);
    setSaved(result.saved);
    setFailed(!result.ok);
  }

  return (
    <button
      type="button"
      className={small ? "save-btn small" : "save-btn"}
      onClick={click}
      aria-pressed={saved}
      title={failed ? "This browser doesn't allow saving (private mode or storage full)" : undefined}
    >
      {failed ? "Can't save here" : saved ? "Saved" : "Save"}
    </button>
  );
}
