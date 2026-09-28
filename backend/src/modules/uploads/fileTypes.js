// Allowed upload types. The stored file extension always comes from this map (never from the
// user's file name), so a file can't be served as HTML/JS by giving it a misleading name.
export const ALLOWED_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx"
};

export const ALLOWED_TYPES_MESSAGE = "Use images, PDF, Word or Excel files.";

export function safeBaseName(fileName) {
  const withoutExt = String(fileName).replace(/\.[^.]*$/, "");
  return withoutExt.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 80) || "file";
}
