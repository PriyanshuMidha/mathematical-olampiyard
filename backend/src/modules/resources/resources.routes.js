import { Router } from "express";
import { asyncHandler as h } from "../../core/asyncHandler.js";
import { uploadSingle } from "../uploads/storage.js";

const file = uploadSingle("file", "resources");
import * as resources from "./resources.service.js";

export const publicRouter = Router();
publicRouter.get(
  "/resources",
  h(async (_req, res) => {
    res.set("Cache-Control", "public, max-age=30");
    res.json(await resources.listPublished());
  })
);

export const adminRouter = Router();
adminRouter.get("/resources", h(async (req, res) => res.json(await resources.listAll(req.query))));
adminRouter.post("/resources", file, h(async (req, res) => res.status(201).json(await resources.create(req.body, req.file))));
adminRouter.put("/resources/:id", file, h(async (req, res) => res.json(await resources.update(req.params.id, req.body, req.file))));
adminRouter.delete(
  "/resources/:id",
  h(async (req, res) => {
    await resources.remove(req.params.id);
    res.json({ ok: true });
  })
);
