import { Router } from "express";
import { asyncHandler as h } from "../../core/asyncHandler.js";
import { notFound } from "../../core/errors.js";
import { uploadFields } from "../uploads/storage.js";
import * as news from "./news.service.js";

const files = uploadFields([{ name: "image", maxCount: 1 }, { name: "attachment", maxCount: 1 }]);

export const publicRouter = Router();
publicRouter.get(
  "/news",
  h(async (req, res) => {
    res.set("Cache-Control", "public, max-age=30");
    res.json(await news.listPublished(req.query));
  })
);
publicRouter.get(
  "/news/:slug",
  h(async (req, res) => {
    const data = await news.getPublishedBySlug(req.params.slug);
    if (!data) throw notFound("News");
    res.set("Cache-Control", "public, max-age=30");
    res.json(data);
  })
);

export const adminRouter = Router();
adminRouter.get("/news", h(async (req, res) => res.json(await news.listAll(req.query))));
adminRouter.get("/news/:id", h(async (req, res) => res.json(await news.getById(req.params.id))));
adminRouter.post("/news", files, h(async (req, res) => res.status(201).json(await news.create(req.body, req.files))));
adminRouter.put("/news/:id", files, h(async (req, res) => res.json(await news.update(req.params.id, req.body, req.files))));
adminRouter.delete(
  "/news/:id",
  h(async (req, res) => {
    await news.remove(req.params.id);
    res.json({ ok: true });
  })
);
