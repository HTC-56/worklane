import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.js";
import { createDatabase, createQueue } from "../src/db/index.js";
import type { Queue } from "../src/db/queue.js";
import { EventBus, type JobEvent } from "../src/events.js";
import { Ledger } from "../src/ledger.js";
import { RunningJobs } from "../src/workers/running-jobs.js";
import { defaultConfig, type Config, type HandlerContext } from "../src/types.js";

/** Fast, deterministic settings — every timing here is milliseconds, not seconds. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return defaultConfig({
    dbPath: ":memory:",
    pollIntervalMs: 10,
    heartbeatIntervalMs: 40,
    leaseDurationMs: 2_000,
    killGraceMs: 150,
    baseBackoffMs: 10,
    maxBackoffMs: 50,
    workerCount: 1,
    ledgerPath: "",
    sseHeartbeatMs: 1_000,
    ...overrides,
  });
}

/** An in-memory queue plus the registry cancel needs. Close `db` when done. */
export function testQueue(config: Config): {
  db: ReturnType<typeof createDatabase>;
  queue: Queue;
  runningJobs: RunningJobs;
} {
  const db = createDatabase(":memory:");
  const runningJobs = new RunningJobs();
  const queue = createQueue(db, config, runningJobs);
  return { db, queue, runningJobs };
}

/** A handler context for calling a handler directly, without a worker. */
export function testContext(): {
  ctx: HandlerContext;
  controller: AbortController;
  captured: { stdout: string; stderr: string; progress: unknown[] };
} {
  const controller = new AbortController();
  const captured = { stdout: "", stderr: "", progress: [] as unknown[] };
  const ctx: HandlerContext = {
    jobId: 1,
    workerId: "test-worker",
    signal: controller.signal,
    progress: (update) => {
      captured.progress.push(update);
    },
    output: (stdout, stderr) => {
      captured.stdout = stdout;
      captured.stderr = stderr;
    },
  };
  return { ctx, controller, captured };
}

/** Absolute path to a file under test/fixtures. */
export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** Polls `predicate` until it is true, or throws after `timeoutMs`. */
export async function waitFor(
  predicate: () => boolean,
  message = "condition",
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${message}`);
}

/**
 * A scratch directory outside the repo, for things a fixture needs to write.
 * Returns the path plus its cleanup function.
 */
export function scratchDir(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), "worklane-test-"));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Everything an HTTP test needs, on an in-memory database with no workers. */
export interface TestApp {
  app: FastifyInstance;
  queue: Queue;
  bus: EventBus;
  ledger: Ledger | null;
  db: ReturnType<typeof createDatabase>;
  runningJobs: RunningJobs;
  config: Config;
  /** Bearer header for `app.inject`, empty when the config has no token. */
  auth: Record<string, string>;
  close(): Promise<void>;
}

/**
 * Builds the real Fastify app over a real (in-memory) queue. Drive it with
 * `app.inject({ method, url, headers, payload })` — no socket needed. A
 * `ledgerPath` in the overrides turns the JSONL ledger on.
 */
export function testApp(overrides: Partial<Config> = {}): TestApp {
  const config = testConfig(overrides);
  const db = createDatabase(":memory:");
  const bus = new EventBus(config.eventBufferSize);
  const ledger = config.ledgerPath === "" ? null : new Ledger(config.ledgerPath);
  if (ledger) bus.subscribe((event) => ledger.write(event));

  const runningJobs = new RunningJobs();
  const queue = createQueue(db, config, runningJobs);
  queue.setEventSink(bus);

  const app = createApp({ queue, config, bus, ledger, version: "test" });
  const auth: Record<string, string> = {};
  if (config.bearerToken !== undefined) {
    auth["authorization"] = `Bearer ${config.bearerToken}`;
  }

  return {
    app,
    queue,
    bus,
    ledger,
    db,
    runningJobs,
    config,
    auth,
    async close(): Promise<void> {
      await app.close();
      db.close();
    },
  };
}

/** Binds a TestApp to a loopback port. Returns its base URL, e.g. http://127.0.0.1:1234 */
export async function listenTestApp(target: TestApp): Promise<string> {
  return target.app.listen({ port: 0, host: "127.0.0.1" });
}

export interface SseEvent {
  kind: string;
  data: JobEvent;
}

/**
 * Opens an SSE stream and resolves once `count` events have arrived. `onOpen`
 * fires as soon as the stream is live — do the work that should produce the
 * events there, or they may be emitted before anyone is listening.
 */
export async function readSseEvents(
  url: string,
  opts: {
    count: number;
    token?: string;
    timeoutMs?: number;
    onOpen?: () => void | Promise<void>;
  },
): Promise<SseEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5_000);
  const headers: Record<string, string> = { accept: "text/event-stream" };
  if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`;

  const response = await fetch(url, { headers, signal: controller.signal });
  if (!response.ok || !response.body) {
    clearTimeout(timer);
    throw new Error(`SSE request failed with status ${String(response.status)}`);
  }

  const events: SseEvent[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let opened = false;

  try {
    while (events.length < opts.count) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseBlock(block);
        if (parsed) events.push(parsed);
        boundary = buffer.indexOf("\n\n");
      }

      if (!opened) {
        opened = true;
        await opts.onOpen?.();
      }
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
    controller.abort();
  }

  return events;
}

function parseSseBlock(block: string): SseEvent | null {
  let kind = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) kind = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { kind, data: JSON.parse(dataLines.join("\n")) as JobEvent };
}

/** Reads a JSONL ledger file back as parsed events. */
export function readLedger(path: string): JobEvent[] {
  const text = readFileSync(path, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JobEvent);
}
