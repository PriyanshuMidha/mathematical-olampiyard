import { Router } from "express";
import { config } from "../../config/env.js";
import { RESOURCE_TYPES } from "../resources/resource.model.js";
import { MAX_R2_UPLOAD_BYTES, isR2Configured } from "../uploads/r2.js";
import { PREFERENCES } from "../users/subscriber.model.js";

// Fixed option lists the frontend needs, served from the backend so the two never drift apart.
export const publicRouter = Router();
publicRouter.get("/meta", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.json({ resourceTypes: RESOURCE_TYPES, userPreferences: PREFERENCES, maxUploadMb: config.uploads.maxMb, maxCloudUploadBytes: MAX_R2_UPLOAD_BYTES, cloudUploads: isR2Configured() });
});
