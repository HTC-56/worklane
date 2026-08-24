import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Queue } from "../db/queue.js";
import { schemaVersion } from "../db/schema.js";
import type { EventBus, JobEvent } from "../events.js";
import type { Ledger } from "../ledger.js";
import type { Config, QueueStats } from "../types.js";

export interface OpsDeps {
  queue: Queue;
  config: Config;
  bus: EventBus;
  ledger: Ledger | null;
  startedAt: number;
  version: string;
}

const RecentQuerySchema = z.object({
  replay: z.coerce.number().int().nonnegative().max(500).default(25),
});

/** Prometheus label values escape backslash, double quote and newline. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

const STAT_LABELS: [keyof QueueStats, string][] = [
  ["pending", "pending"],
  ["claimed", "claimed"],
  ["running", "running"],
  ["failed", "failed"],
  ["succeeded", "succeeded"],
  ["deadLetter", "dead_letter"],
  ["cancelled", "cancelled"],
];

function renderMetrics(deps: OpsDeps): string {
  const { queue, bus, startedAt } = deps;
  const stats = queue.getStats();
  const workers = queue.getWorkers();
  const lines: string[] = [];

  lines.push("# HELP worklane_jobs Jobs currently in each state.");
  lines.push("# TYPE worklane_jobs gauge");
  for (const [key, label] of STAT_LABELS) {
    lines.push(`worklane_jobs{state="${label}"} ${stats[key]}`);
  }

  lines.push("# HELP worklane_jobs_by_type Jobs in each state, by job type.");
  lines.push("# TYPE worklane_jobs_by_type gauge");
  for (const row of queue.byType()) {
    const type = escapeLabel(row.type);
    lines.push(`worklane_jobs_by_type{type="${type}",state="pending"} ${row.pending}`);
    lines.push(`worklane_jobs_by_type{type="${type}",state="running"} ${row.running}`);
    lines.push(
      `worklane_jobs_by_type{type="${type}",state="succeeded"} ${row.succeeded}`,
    );
    lines.push(`worklane_jobs_by_type{type="${type}",state="failed"} ${row.failed}`);
    lines.push(
      `worklane_jobs_by_type{type="${type}",state="dead_letter"} ${row.deadLetter}`,
    );
    lines.push(
      `worklane_jobs_by_type{type="${type}",state="cancelled"} ${row.cancelled}`,
    );
  }

  lines.push(
    "# HELP worklane_jobs_succeeded_recent Jobs of this type that succeeded inside the throughput window.",
  );
  lines.push("# TYPE worklane_jobs_succeeded_recent gauge");
  for (const row of queue.byType()) {
    lines.push(
      `worklane_jobs_succeeded_recent{type="${escapeLabel(row.type)}"} ${row.succeededRecently}`,
    );
  }

  lines.push("# HELP worklane_workers Registered workers.");
  lines.push("# TYPE worklane_workers gauge");
  lines.push(`worklane_workers ${workers.length}`);

  lines.push("# HELP worklane_workers_busy Workers currently holding a job.");
  lines.push("# TYPE worklane_workers_busy gauge");
  lines.push(
    `worklane_workers_busy ${workers.filter((w) => w.claimedJobId !== null).length}`,
  );

  lines.push("# HELP worklane_event_subscribers Open /events streams.");
  lines.push("# TYPE worklane_event_subscribers gauge");
  lines.push(`worklane_event_subscribers ${bus.subscriberCount}`);

  lines.push("# HELP worklane_uptime_seconds Seconds since this process started.");
  lines.push("# TYPE worklane_uptime_seconds gauge");
  lines.push(`worklane_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(3)}`);

  return `${lines.join("\n")}\n`;
}

/**
 * `/healthz`, `/metrics`, `/stats` and the `/events` SSE stream. `/healthz` is
 * the one route that never asks for a bearer token — a health check that needs
 * a credential is not a health check.
 */
export function registerOpsRoutes(app: FastifyInstance, deps: OpsDeps): void {
  const { queue, config, bus, ledger, startedAt, version } = deps;

  app.get("/healthz", async (_request, reply) => {
    return reply.send({
      ok: true,
      version,
      schemaVersion: schemaVersion(queue.database),
      uptimeMs: Date.now() - startedAt,
      stats: queue.getStats(),
      workers: queue.getWorkers().length,
      ledger: ledger
        ? { path: ledger.path, writeFailures: ledger.writeFailures }
        : null,
    });
  });

  app.get("/stats", async (_request, reply) => {
    return reply.send({
      stats: queue.getStats(),
      byType: queue.byType(),
      workers: queue.getWorkers(),
      running: queue.listJobs("RUNNING", 50),
      throughputWindowMs: config.throughputWindowMs,
      now: Date.now(),
    });
  });

  app.get("/metrics", async (_request, reply) => {
    return reply
      .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
      .send(renderMetrics(deps));
  });

  // SSE: hijack the reply so Fastify stops managing it, then own the socket
  // until the client goes away. `?replay=N` re-sends the last N events first.
  app.get("/events", (request, reply) => {
    const { replay } = RecentQuerySchema.parse(request.query);
    reply.hijack();
    const res = reply.raw;

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(": worklane event stream\n\n");

    const send = (event: JobEvent): void => {
      if (res.writableEnded) return;
      res.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    if (replay > 0) for (const event of bus.recent(replay)) send(event);

    const unsubscribe = bus.subscribe(send);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, config.sseHeartbeatMs);
    heartbeat.unref?.();

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (!res.writableEnded) res.end();
    };

    request.raw.on("close", close);
    request.raw.on("error", close);
    res.on("error", close);
  });
}
