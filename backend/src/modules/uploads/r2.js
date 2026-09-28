import crypto from "crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../../config/env.js";
import { AppError, badRequest } from "../../core/errors.js";
import { ALLOWED_TYPES, ALLOWED_TYPES_MESSAGE, safeBaseName } from "./fileTypes.js";
import { LIMIT_BYTES, isPending, markDone, onObjectDeleted, release, reserve } from "./quota.js";

// Cloudflare R2 (S3-compatible) direct-from-browser uploads. Works across any number of API instances.
const r2 = config.r2;
// A single file can never be larger than the whole storage cap.
export const MAX_R2_UPLOAD_BYTES = Math.min(Math.floor(r2.maxUploadGb * 1024 ** 3), LIMIT_BYTES);
export const R2_PART_SIZE = r2.partSizeBytes;
const DIRECT_UPLOAD_LIMIT = 5 * 1024 * 1024 * 1024;
// Direct browser uploads: <folder>/<date>/<name>. Server uploads (content-addressed): files/<name>-<hash>.<ext>.
export const KEY_PATTERN = /^((news|results|resources|uploads)\/\d{4}-\d{2}-\d{2}|files)\/[a-z0-9-]+\.[a-z0-9]+$/;

function required(name, value) {
  if (!value) throw badRequest(`${name} is required for Cloudflare R2 uploads`);
  return value;
}

let client;
function r2Client() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: r2.endpoint || `https://${required("R2_ACCOUNT_ID", r2.accountId)}.r2.cloudflarestorage.com`,
      forcePathStyle: Boolean(r2.endpoint),
      // Cloudflare R2 guidance for aws-sdk-js v3 >= 3.729: don't add the new default CRC checksums.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: required("R2_ACCESS_KEY_ID", r2.accessKeyId),
        secretAccessKey: required("R2_SECRET_ACCESS_KEY", r2.secretAccessKey)
      }
    });
  }
  return client;
}

const bucket = () => required("R2_BUCKET", r2.bucket);

export function isR2Configured() {
  return Boolean(r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket && r2.publicUrl);
}

// Server-side upload (used for normal form uploads when R2 is configured). Counts against the storage cap.
export async function putObject({ key, body, contentType }) {
  const reservedHere = await reserve(key, body.length);
  try {
    // Content-addressed name -> safe to cache for a year.
    await r2Client().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
  } catch (error) {
    if (reservedHere) await release(key);
    throw error;
  }
  if (reservedHere) await markDone(key, body.length);
  return objectUrl(key);
}

export async function objectExists(key) {
  return (await objectSize(key)) !== null;
}

async function objectSize(key) {
  try {
    const head = await r2Client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return head.ContentLength ?? 0;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return null;
    throw error;
  }
}

async function deleteKey(key) {
  const size = await objectSize(key);
  if (size === null) return 0;
  await r2Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  await onObjectDeleted(key, size);
  return size;
}

export function keyFromUrl(url) {
  if (!r2.publicUrl || typeof url !== "string" || !url.startsWith(`${r2.publicUrl}/`)) return null;
  const key = url.slice(r2.publicUrl.length + 1).split("/").map(decodeURIComponent).join("/");
  return KEY_PATTERN.test(key) ? key : null;
}

// Deletes an object given its public URL; ignores URLs that aren't in our bucket.
export async function deleteObjectByUrl(url) {
  if (!isR2Configured()) return;
  const key = keyFromUrl(url);
  if (key) await deleteKey(key);
}

// ---------- used by the scheduled jobs ----------

export async function* listObjects() {
  let token;
  do {
    const page = await r2Client().send(new ListObjectsV2Command({ Bucket: bucket(), ContinuationToken: token, MaxKeys: 1000 }));
    for (const item of page.Contents || []) yield { key: item.Key, size: item.Size || 0, lastModified: item.LastModified };
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

// Incomplete multipart uploads keep their parts (and count as storage) until aborted.
export async function abortStaleMultipartUploads(olderThanMs) {
  let aborted = 0;
  let keyMarker;
  let uploadIdMarker;
  const cutoff = Date.now() - olderThanMs;
  do {
    const page = await r2Client().send(new ListMultipartUploadsCommand({ Bucket: bucket(), KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker }));
    for (const upload of page.Uploads || []) {
      if (upload.Initiated && upload.Initiated.getTime() < cutoff) {
        await r2Client().send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: upload.Key, UploadId: upload.UploadId }));
        await release(upload.Key);
        aborted += 1;
      }
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
  } while (keyMarker);
  return aborted;
}

export { deleteKey };

export function objectUrl(key) {
  const base = required("R2_PUBLIC_URL", r2.publicUrl);
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

// Keys come back from the browser on sign/complete/abort, so only accept keys this API could have issued.
export function assertKey(key) {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) throw badRequest("Invalid upload key");
  return key;
}

export function assertAllowedFile({ fileName, fileType, fileSize }) {
  if (!fileName || typeof fileName !== "string") throw badRequest("File name is required");
  if (!ALLOWED_TYPES[fileType]) throw badRequest(`File type is not allowed. ${ALLOWED_TYPES_MESSAGE}`);
  if (!Number.isFinite(fileSize) || fileSize <= 0) throw badRequest("File size is required");
  if (fileSize > MAX_R2_UPLOAD_BYTES) throw badRequest(`File is too large. Maximum Cloudflare upload size is ${r2.maxUploadGb} GB.`);
}

export function buildObjectKey({ fileName, fileType, folder = "uploads" }) {
  const id = crypto.randomUUID();
  return `${folder}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${id}-${safeBaseName(fileName)}${ALLOWED_TYPES[fileType]}`;
}

export async function startUpload({ fileName, fileType, fileSize, folder }) {
  assertAllowedFile({ fileName, fileType, fileSize });
  const key = buildObjectKey({ fileName, fileType, folder });

  objectUrl(key); // fail early if R2_PUBLIC_URL is missing
  await reserve(key, fileSize); // refuses the upload if the bucket would pass the storage cap

  try {
    if (fileSize <= DIRECT_UPLOAD_LIMIT) {
      // ContentLength is part of the signature, so the browser can't upload more than it declared.
      const command = new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: fileType, ContentLength: fileSize });
      const uploadUrl = await getSignedUrl(r2Client(), command, { expiresIn: 60 * 15 });
      return { type: "direct", uploadUrl, key, publicUrl: objectUrl(key), maxSize: MAX_R2_UPLOAD_BYTES };
    }

    const result = await r2Client().send(new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: fileType }));
    return { type: "multipart", uploadId: result.UploadId, key, partSize: R2_PART_SIZE, publicUrl: objectUrl(key), maxSize: MAX_R2_UPLOAD_BYTES };
  } catch (error) {
    await release(key);
    throw error;
  }
}

export async function signPart({ key, uploadId, partNumber }) {
  const part = Number(partNumber);
  if (!uploadId || !Number.isInteger(part) || part < 1 || part > 10000) throw badRequest("uploadId and a partNumber (1-10000) are required");
  const command = new UploadPartCommand({ Bucket: bucket(), Key: assertKey(key), UploadId: String(uploadId), PartNumber: part });
  return getSignedUrl(r2Client(), command, { expiresIn: 60 * 15 });
}

// Confirms the object really exists and isn't bigger than what was reserved (multipart parts
// aren't size-limited by the signature), then turns the reservation into counted usage.
async function confirmStored(key) {
  const size = await objectSize(key);
  if (size === null) throw badRequest("Upload not found in Cloudflare. Please try again.");
  if (!(await markDone(key, size))) {
    // Remove the object and give back exactly what was reserved (the extra was never counted).
    await r2Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })).catch(() => {});
    await release(key);
    throw new AppError(507, "Uploaded file is larger than declared and would exceed the Cloudflare storage limit.");
  }
  return size;
}

export async function completeUpload({ key, uploadId, parts }) {
  assertKey(key);
  if (!uploadId) {
    await confirmStored(key);
    return { key, publicUrl: objectUrl(key) };
  }
  if (!Array.isArray(parts) || !parts.length || parts.length > 10000) throw badRequest("Multipart parts are required");

  const normalizedParts = parts
    .map((part) => ({ ETag: String(part.ETag || part.etag || ""), PartNumber: Number(part.PartNumber || part.partNumber) }))
    .sort((a, b) => a.PartNumber - b.PartNumber);

  await r2Client().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: String(uploadId),
      MultipartUpload: { Parts: normalizedParts }
    })
  );
  await confirmStored(key);
  return { key, publicUrl: objectUrl(key) };
}

// Cancels an upload. Multipart: aborts it in R2. Direct: deletes anything already written.
// Either way the reserved storage is given back.
export async function abortUpload({ key, uploadId }) {
  assertKey(key);
  if (uploadId) {
    await r2Client().send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: String(uploadId) }));
  } else if (await isPending(key)) {
    // Only an upload that was started but never completed may be removed here; finished files
    // (possibly used by records) are never touched by "abort".
    await deleteKey(key).catch(() => {});
  }
  await release(key);
  return { ok: true };
}
