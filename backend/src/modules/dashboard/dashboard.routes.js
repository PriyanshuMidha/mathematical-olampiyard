import { Router } from "express";
import { config } from "../../config/env.js";
import { asyncHandler as h } from "../../core/asyncHandler.js";
import { cached, invalidate } from "../../core/cache.js";
import { events } from "../../core/events.js";
import { stats as newsStats } from "../news/news.service.js";
import { count as resourceCount } from "../resources/resources.service.js";
import { count as resultCount } from "../results/results.service.js";
import { storageStatus } from "../uploads/uploads.routes.js";
import { activeCount } from "../users/users.service.js";

const KEY = "dashboard:stats";
events.on("content:changed", () => invalidate(KEY));

export const adminRouter = Router();
adminRouter.get(
  "/dashboard",
  h(async (_req, res) => {
    const data = await cached(
      KEY,
      config.cache.dashboardTtlMs,
      async () => {
        const [news, results, resources, subscriberCount, storage] = await Promise.all([newsStats(), resultCount(), resourceCount(), activeCount(), storageStatus()]);
        return { ...news, resultCount: results, resourceCount: resources, subscriberCount, storage };
      },
      { staleMs: 0 }
    );
    res.json(data);
  })
);
