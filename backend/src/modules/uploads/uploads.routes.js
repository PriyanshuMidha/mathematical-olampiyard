import { Router } from "express";
import { asyncHandler as h } from "../../core/asyncHandler.js";
import { badRequest } from "../../core/errors.js";
import Media from "./media.model.js";
import { fileUrl, uploadSingle } from "./storage.js";
import { jobStatus, runJobNow } from "../../core/scheduler.js";
import "./jobs.js";
import { emailStatus } from "../notifications/status.js";
import { usage } from "./quota.js";
import { abortUpload, completeUpload, isR2Configured, signPart, startUpload } from "./r2.js";

const FOLDERS = ["news", "results", "resources", "uploads"];

export const adminRouter = Router();

// Storage usage + scheduled job status for the dashboard.
export async function storageStatus() {
  return isR2Configured() ? { driver: "r2", ...(await usage()) } : { driver: "local" };
}

adminRouter.get(
  "/system",
  h(async (_req, res) => {
    const [storage, jobs, email] = await Promise.all([storageStatus(), jobStatus(), emailStatus()]);
    res.json({ storage, jobs, email });
  })
);
adminRouter.post(
  "/system/jobs/:name/run",
  h(async (req, res) => {
    if (!["storage-reconcile", "orphan-file-cleanup"].includes(req.params.name)) throw badRequest("Unknown job");
    res.json({ result: await runJobNow(req.params.name) });
  })
);

adminRouter.post(
  "/uploads/r2/start",
  h(async (req, res) => {
    const folder = FOLDERS.includes(req.body.folder) ? req.body.folder : "news";
    const payload = await startUpload({
      fileName: String(req.body.fileName || ""),
      fileType: String(req.body.fileType || ""),
      fileSize: Number(req.body.fileSize),
      folder
    });
    res.status(201).json(payload);
  })
);

adminRouter.post("/uploads/r2/sign-part", h(async (req, res) => res.json({ uploadUrl: await signPart(req.body) })));
adminRouter.post("/uploads/r2/complete", h(async (req, res) => res.json(await completeUpload(req.body))));
adminRouter.post("/uploads/r2/abort", h(async (req, res) => res.json(await abortUpload(req.body))));

adminRouter.post(
  "/media",
  uploadSingle("file"),
  h(async (req, res) => {
    if (!req.file) throw badRequest("File is required");
    const media = await Media.create({
      originalName: req.file.originalname,
      filename: req.file.filename,
      url: fileUrl(req.file),
      mimeType: req.file.mimetype,
      size: req.file.size
    });
    res.status(201).json(media);
  })
);
