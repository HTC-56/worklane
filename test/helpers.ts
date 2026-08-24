import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, createQueue } from "../src/db/index.js";
import type { Queue } from "../src/db/queue.js";
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
