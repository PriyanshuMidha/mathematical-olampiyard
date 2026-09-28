import { Router } from "express";
import { config } from "../../config/env.js";
import { asyncHandler as h } from "../../core/asyncHandler.js";
import { cached, invalidate } from "../../core/cache.js";
import { events } from "../../core/events.js";
import { homeSections as newsSections } from "../news/news.service.js";
import { homeSection as resourcesSection } from "../resources/resources.service.js";
import { homeSection as resultsSection } from "../results/results.service.js";

// Composition module: reads from other modules' services (one-way), owns only its cache.
const KEY = "home:payload";
events.on("content:changed", ({ module }) => {
  if (["news", "results", "resources"].includes(module)) invalidate(KEY);
});

async function load() {
  const [news, results, resources] = await Promise.all([newsSections(), resultsSection(), resourcesSection()]);
  return { ...news, results, resources };
}

export const publicRouter = Router();
publicRouter.get(
  "/home",
  h(async (_req, res) => {
    res.set("Cache-Control", "public, max-age=30");
    res.json(await cached(KEY, config.cache.homeTtlMs, load));
  })
);
