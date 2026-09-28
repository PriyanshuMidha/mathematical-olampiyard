import crypto from "crypto";
import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../../config/env.js";
import { badRequest } from "../../core/errors.js";
import { ALLOWED_TYPES, ALLOWED_TYPES_MESSAGE, safeBaseName } from "./fileTypes.js";
import { deleteObjectByUrl, isR2Configured, objectExists, objectUrl, putObject } from "./r2.js";
import { fileId, referencedFileIds } from "./references.js";

// Upload storage for normal form uploads.
// - Cloudflare R2 configured -> files go to R2 (works with any number of API instances).
// - Otherwise -> local disk in backend/uploads (single server only).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = config.uploads.dir || path.join(__dirname, "..", "..", "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const MAX_UPLOAD_MB = config.uploads.maxMb;

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 2, fields: 50 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
    cb(badRequest(`File type ${file.mimetype} is not allowed. ${ALLOWED_TYPES_MESSAGE}`));
  }
});

// Photos straight from phones are often 3-8 MB and 4000+ px wide. They are resized to at most
// 1600 px and re-encoded as WebP (typically 5-20x smaller); the smaller of original/optimized is kept.
const OPTIMIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_SIDE = 1600;
let sharpModule;
async function loadSharp() {
  if (sharpModule === undefined) sharpModule = (await import("sharp").catch(() => null))?.default || null;
  return sharpModule;
}

async function optimizeImage(file) {
  if (!OPTIMIZABLE.has(file.mimetype)) return;
  const sharp = await loadSharp();
  if (!sharp) return; // library unavailable: store the original
  let output;
  try {
    output = await sharp(file.buffer, { limitInputPixels: 60_000_000 })
      .rotate() // respect phone orientation, then strip EXIF (removes GPS location too)
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw badRequest("This image file is damaged or isn't a real image.");
  }
  if (output.length < file.buffer.length) {
    file.buffer = output;
    file.mimetype = "image/webp";
  }
  file.size = file.buffer.length;
}

// Content-addressed names: the same file uploaded again (same name + same bytes) maps to the same
// stored object, so it is stored — and counted against the storage cap — only once.
// The extension comes from the validated MIME type, never from the user's file name.
function storedName(file) {
  const hash = crypto.createHash("sha256").update(file.buffer).digest("hex").slice(0, 24);
  return `${safeBaseName(file.originalname)}-${hash}${ALLOWED_TYPES[file.mimetype]}`;
}

async function persist(file) {
  await optimizeImage(file);
  const name = storedName(file);
  if (isR2Configured()) {
    const key = `files/${name}`;
    file.reused = await objectExists(key);
    file.url = file.reused ? objectUrl(key) : await putObject({ key, body: file.buffer, contentType: file.mimetype });
  } else {
    const target = path.join(UPLOAD_DIR, name);
    file.reused = await fs.promises.stat(target).then(() => true, () => false);
    if (!file.reused) await fs.promises.writeFile(target, file.buffer);
    // Built from API_URL, never from the request Host header.
    file.url = `${config.apiUrl}/uploads/${name}`;
  }
  file.filename = name;
  file.buffer = undefined; // release memory early
}

function persistMiddleware() {
  return async (req, _res, next) => {
    try {
      const files = req.file ? [req.file] : Object.values(req.files || {}).flat();
      for (const file of files) await persist(file);
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Route helpers: parse multipart + store files. Each stored file gets `file.url`.
export const uploadSingle = (field) => [parser.single(field), persistMiddleware()];
export const uploadFields = (fields) => [parser.fields(fields), persistMiddleware()];

export function fileUrl(file) {
  return file?.url || "";
}

export function requestFiles(req) {
  if (req.file) return [req.file];
  return Object.values(req.files || {}).flat();
}

// Deletes a stored file (local or R2) when its record is deleted/replaced or its request failed,
// unless another record still uses the same (deduplicated) file.
// Never throws: a missing file must not break the request.
export async function removeStoredFile(url) {
  if (!url || typeof url !== "string") return;
  try {
    // Identical uploads share one stored file: keep it while any record still points to it.
    if ((await referencedFileIds()).has(fileId(url))) return;
    const localPrefix = [`${config.apiUrl}/uploads/`, "/uploads/"].find((p) => url.startsWith(p));
    if (localPrefix) {
      await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(url.slice(localPrefix.length)))).catch(() => {});
      return;
    }
    await deleteObjectByUrl(url);
  } catch (error) {
    console.error("Could not delete stored file:", error.message);
  }
}
