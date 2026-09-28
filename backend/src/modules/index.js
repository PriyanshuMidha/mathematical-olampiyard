// Feature registry. Each module exposes any of:
//   publicRouter     -> mounted at /api
//   openAdminRouter  -> mounted at /api/admin, no auth (login)
//   adminRouter      -> mounted at /api/admin, behind requireAdmin
// To add a feature: create modules/<name>/<name>.routes.js and add one line here.
import * as auth from "./auth/auth.routes.js";
import * as dashboard from "./dashboard/dashboard.routes.js";
import * as home from "./home/home.routes.js";
import * as meta from "./meta/meta.routes.js";
import * as news from "./news/news.routes.js";
import * as resources from "./resources/resources.routes.js";
import * as results from "./results/results.routes.js";
import * as taxonomy from "./taxonomy/taxonomy.routes.js";
import * as uploads from "./uploads/uploads.routes.js";
import * as users from "./users/users.routes.js";

export const modules = [auth, home, meta, news, results, resources, taxonomy, users, uploads, dashboard];
