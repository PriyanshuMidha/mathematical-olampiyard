import fs from "fs";
import path from "path";
import { config } from "../../config/env.js";
import { registerJob } from "../../core/scheduler.js";
import Media from "./media.model.js";
import { pendingKeys, reconcile } from "./quota.js";
import { KEY_PATTERN, abortStaleMultipartUploads, deleteKey, isR2Configured, listObjects } from "./r2.js";
import { fileId, referencedFileIds, registerFileReferences } from "./references.js";
import { UPLOAD_DIR } from "./storage.js";

const DAY = 24 * 60 * 60_000;
const graceMs = () => config.jobs.orphanGraceHours * 60 * 60_000;

registerFileReferences(async () => Media.distinct("url"));

// Hourly: recount the real bucket size (keeps the 9.5 GB cap accurate) and abort
// multipart uploads that were started but never finished (their parts use storage).
registerJob({
  name: "storage-reconcile",
  everyMs: config.jobs.storageReconcileMs,
  run: async () => {
    if (!isR2Configured()) return { skipped: "R2 not configured" };
    const abortedMultipart = await abortStaleMultipartUploads(DAY);
    let bucketBytes = 0;
    let objects = 0;
    for await (const object of listObjects()) {
      bucketBytes += object.size;
      objects += 1;
    }
    return { abortedMultipart, ...(await reconcile({ bucketBytes, objects })) };
  }
});

// Daily: delete uploaded files that no record uses any more and that are older than the grace period
// (e.g. an admin uploaded a file but never saved the news item). Never runs a deletion if the list of
// referenced files couldn't be loaded.
registerJob({
  name: "orphan-file-cleanup",
  everyMs: config.jobs.orphanCleanupMs,
  lockMs: 60 * 60_000,
  run: async () => {
    const referenced = await referencedFileIds();
    const cutoff = Date.now() - graceMs();
    const result = { localDeleted: 0, r2Deleted: 0, freedBytes: 0 };

    for (const name of await fs.promises.readdir(UPLOAD_DIR).catch(() => [])) {
      if (name.startsWith(".") || referenced.has(name)) continue;
      const full = path.join(UPLOAD_DIR, name);
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat?.isFile() || stat.mtimeMs > cutoff) continue;
      await fs.promises.unlink(full).catch(() => {});
      result.localDeleted += 1;
      result.freedBytes += stat.size;
    }

    if (isR2Configured()) {
      const pending = await pendingKeys();
      const orphans = [];
      for await (const object of listObjects()) {
        if (!KEY_PATTERN.test(object.key) || pending.has(object.key) || referenced.has(fileId(object.key))) continue;
        if (!object.lastModified || object.lastModified.getTime() > cutoff) continue;
        orphans.push(object.key);
      }
      for (const key of orphans) {
        result.freedBytes += await deleteKey(key);
        result.r2Deleted += 1;
      }
    }
    return result;
  }
});
