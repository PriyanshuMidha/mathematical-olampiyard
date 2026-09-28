import { Router } from "express";
import { asyncHandler as h } from "../../core/asyncHandler.js";
import { uploadSingle } from "../uploads/storage.js";

const file = uploadSingle("file");
import * as results from "./results.service.js";

export const publicRouter = Router();
publicRouter.get(
  "/results",
  h(async (_req, res) => {
    res.set("Cache-Control", "public, max-age=30");
    res.json(await results.listPublished());
  })
);

export const adminRouter = Router();
adminRouter.get("/results", h(async (req, res) => res.json(await results.listAll(req.query))));
adminRouter.post("/results", file, h(async (req, res) => res.status(201).json(await results.create(req.body, req.file))));
adminRouter.put("/results/:id", file, h(async (req, res) => res.json(await results.update(req.params.id, req.body, req.file))));
adminRouter.delete(
  "/results/:id",
  h(async (req, res) => {
    await results.remove(req.params.id);
    res.json({ ok: true });
  })
);
