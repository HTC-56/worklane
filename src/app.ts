import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Queue } from "./db/queue.js";
import { DuplicateJobError, UnknownParentError } from "./errors.js";
import type { EventBus } from "./events.js";
import type { Ledger } from "./ledger.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerOpsRoutes } from "./routes/ops.js";
import type { Config } from "./types.js";

export interface AppDeps {
  queue: Queue;
  config: Config;
  bus: EventBus;
  ledger?: Ledger | null;
  startedAt?: number;
  version?: string;
}

/** Routes that answer without a bearer token. A gated health check is useless. */
const PUBLIC_PATHS = new Set(["/healthz"]);

/** Length-aware constant-time compare, so the token cannot be probed by timing. */
function secretsMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The whole HTTP surface. Auth is one static bearer token (SPEC non-goal: no
 * multi-tenant auth); leaving `bearerToken` unset opens the API, which is only
 * ever appropriate on a loopback bind.
 */
export function createApp(deps: AppDeps): FastifyInstance {
  const { queue, config, bus } = deps;
  const app = Fastify({ logger: false });
  const token = config.bearerToken;

  app.addHook("onRequest", async (request, reply) => {
    if (token === undefined) return;
    const path = request.url.split("?")[0] ?? request.url;
    if (PUBLIC_PATHS.has(path)) return;

    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      await reply
        .code(401)
        .header("www-authenticate", 'Bearer realm="worklane"')
        .send({ error: "missing bearer token" });
      return;
    }
    if (!secretsMatch(header.slice("Bearer ".length), token)) {
      await reply.code(401).send({ error: "invalid bearer token" });
      return;
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DuplicateJobError) {
      return reply.code(409).send({
        error: error.message,
        dedupeKey: error.dedupeKey,
        existingJobId: error.existingJobId,
      });
    }
    if (error instanceof UnknownParentError) {
      return reply.code(400).send({ error: error.message });
    }
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: "invalid request", issues: error.issues });
    }
    const asHttp = error as { statusCode?: number; message?: string };
    return reply
      .code(asHttp.statusCode ?? 500)
      .send({ error: asHttp.message ?? "internal error" });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({ error: `no route for ${request.url}` });
  });

  registerJobRoutes(app, queue);
  registerOpsRoutes(app, {
    queue,
    config,
    bus,
    ledger: deps.ledger ?? null,
    startedAt: deps.startedAt ?? Date.now(),
    version: deps.version ?? "0.1.0",
  });

  return app;
}
