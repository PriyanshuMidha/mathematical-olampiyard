import { Router } from "express";
import { asyncHandler as h } from "../../core/asyncHandler.js";
import { createTaxonomy, deleteTaxonomy, listTaxonomies, listTaxonomiesAdmin } from "./taxonomy.service.js";

export const publicRouter = Router();
publicRouter.get(
  "/taxonomies",
  h(async (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json(await listTaxonomies());
  })
);

export const adminRouter = Router();
adminRouter.get("/taxonomies", h(async (_req, res) => res.json(await listTaxonomiesAdmin())));
adminRouter.post("/taxonomies", h(async (req, res) => res.status(201).json(await createTaxonomy(req.body))));
adminRouter.delete(
  "/taxonomies/:id",
  h(async (req, res) => {
    await deleteTaxonomy(req.params.id);
    res.json({ ok: true });
  })
);
