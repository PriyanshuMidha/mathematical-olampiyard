import junior from "../assets/news-defaults/junior.svg";
import news from "../assets/news-defaults/news.svg";
import results from "../assets/news-defaults/results.svg";
import senior from "../assets/news-defaults/senior.svg";

export const DEFAULT_NEWS_IMAGES = { news, results, junior, senior };

// Picture for a news item: the uploaded image if there is one, otherwise a themed default.
//   category "Result"          -> results (trophy)
//   level Foundation / Junior  -> junior
//   level Senior               -> senior
//   anything else              -> news
export function newsImage(item) {
  if (item?.imageUrl) return { src: item.imageUrl, isDefault: false };
  const level = String(item?.level || "").toLowerCase();
  let key = "news";
  if (String(item?.category || "").toLowerCase() === "result") key = "results";
  else if (level === "junior" || level === "foundation") key = "junior";
  else if (level === "senior") key = "senior";
  return { src: DEFAULT_NEWS_IMAGES[key], isDefault: true };
}
