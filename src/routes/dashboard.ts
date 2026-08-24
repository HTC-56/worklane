import type { FastifyInstance } from "fastify";
import { dashboardHtml } from "../dashboard/index.js";

/**
 * `GET /` — SPEC feature 8. One self-contained page, served as-is.
 *
 * The shell is deliberately unauthenticated (see `app.ts`'s PUBLIC_PATHS): it
 * carries no queue data, and a browser cannot attach an `Authorization` header
 * to a top-level navigation, so gating it would make the dashboard unreachable
 * exactly when a bearer token is configured. Every byte of data the page shows
 * arrives through an authenticated `fetch` it makes itself.
 */
export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get("/", async (_request, reply) => {
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(dashboardHtml());
  });
}
