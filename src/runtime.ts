import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";
import { createDatabase, createQueue } from "./db/index.js";
import type { Queue } from "./db/queue.js";
import { EventBus } from "./events.js";
import { createExecHandler } from "./handlers/exec.js";
import { Ledger } from "./ledger.js";
import type { Config, Handler } from "./types.js";
import { RunningJobs } from "./workers/running-jobs.js";
import { Worker } from "./workers/worker.js";

export interface Runtime {
  config: Config;
  db: Database.Database;
  queue: Queue;
  bus: EventBus;
  ledger: Ledger | null;
  runningJobs: RunningJobs;
  handlers: Map<string, Handler>;
  workers: Worker[];
  app: FastifyInstance;
  /** Starts the workers, the lease sweeper and the HTTP listener. */
  listen(): Promise<string>;
  stop(): Promise<void>;
}

/**
 * One box, one process: a SQLite file, N workers, the event bus, the ledger and
 * the HTTP surface, wired together and shut down in the right order. Everything
 * `src/server.ts` does beyond this is reading config and catching signals.
 */
export function createRuntime(config: Config, extraHandlers: Handler[] = []): Runtime {
  const db = createDatabase(config.dbPath);
  const bus = new EventBus(config.eventBufferSize);
  const ledger = config.ledgerPath === "" ? null : new Ledger(config.ledgerPath);
  if (ledger) bus.subscribe((event) => ledger.write(event));

  const runningJobs = new RunningJobs();
  const queue = createQueue(db, config, runningJobs);
  queue.setEventSink(bus);

  const handlers = new Map<string, Handler>();
  for (const handler of [createExecHandler(config), ...extraHandlers]) {
    handlers.set(handler.type, handler);
  }

  const workers: Worker[] = [];
  for (let i = 0; i < config.workerCount; i += 1) {
    workers.push(
      new Worker({
        queue,
        handlers,
        config,
        workerId: `worker-${String(i + 1)}`,
        runningJobs,
      }),
    );
  }

  const startedAt = Date.now();
  const app = createApp({ queue, config, bus, ledger, startedAt });

  // A lapsed lease is what makes a dead worker recoverable, so somebody has to
  // look for them; half a lease is often enough to notice and never too eager.
  let sweeper: NodeJS.Timeout | null = null;
  let stopped = false;

  return {
    config,
    db,
    queue,
    bus,
    ledger,
    runningJobs,
    handlers,
    workers,
    app,

    async listen(): Promise<string> {
      for (const worker of workers) void worker.start();
      sweeper = setInterval(
        () => {
          queue.releaseStaleLeases();
        },
        Math.max(1_000, Math.floor(config.leaseDurationMs / 2)),
      );
      sweeper.unref?.();
      return app.listen({ port: config.httpPort, host: config.httpHost });
    },

    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (sweeper) clearInterval(sweeper);
      await app.close();
      await Promise.all(workers.map((worker) => worker.stop()));
      queue.setEventSink(null);
      db.close();
    },
  };
}
