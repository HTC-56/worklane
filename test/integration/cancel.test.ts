import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { Queue } from "../../src/db/queue.js";
import { createExecHandler } from "../../src/handlers/exec.js";
import { createWorker, type Worker } from "../../src/workers/worker.js";
import type { RunningJobs } from "../../src/workers/running-jobs.js";
import type { Config, Handler } from "../../src/types.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixture, scratchDir, testConfig, testQueue, waitFor } from "../helpers.js";

const config: Config = testConfig({ killGraceMs: 200 });

describe("real cancel of a running child process", () => {
  let db: Database.Database;
  let queue: Queue;
  let runningJobs: RunningJobs;
  let worker: Worker;

  beforeEach(() => {
    ({ db, queue, runningJobs } = testQueue(config));
    const handlers = new Map<string, Handler>([["exec", createExecHandler(config)]]);
    worker = createWorker({
      queue,
      handlers,
      config,
      workerId: "cancel-worker",
      runningJobs,
    });
  });

  afterEach(async () => {
    await worker.stop();
    db.close();
  });

  it("escalates to SIGKILL against a child that ignores SIGTERM", async () => {
    const scratch = scratchDir();
    const readyPath = join(scratch.path, "ready");
    const job = queue.enqueue({
      type: "exec",
      payload: {
        command: process.execPath,
        args: [fixture("ignore-sigterm.js"), readyPath],
      },
    });

    void worker.start();
    await waitFor(() => existsSync(readyPath), "the child to ignore SIGTERM");

    const result = await queue.cancelJob(job.id);
    expect(result.wasRunning).toBe(true);
    expect(result.signal).toBe("SIGKILL");

    const cancelled = queue.getById(job.id);
    expect(cancelled?.state).toBe("CANCELLED");
    expect(cancelled?.lastError).toBe("cancelled by SIGKILL");
    expect(cancelled?.errorTrail).toContain("cancelled by SIGKILL");
    expect(cancelled?.workerId).toBeNull();
    scratch.cleanup();
  });

  it("records SIGTERM when the child goes down on the first signal", async () => {
    const job = queue.enqueue({
      type: "exec",
      payload: { command: process.execPath, args: [fixture("sleep.js"), "5000"] },
    });

    void worker.start();
    await waitFor(() => queue.getById(job.id)?.state === "RUNNING", "job to start");

    const result = await queue.cancelJob(job.id);
    expect(result.signal).toBe("SIGTERM");
    expect(queue.getById(job.id)?.lastError).toBe("cancelled by SIGTERM");
  });

  it("does not retry a cancelled job — CANCELLED is terminal", async () => {
    const job = queue.enqueue({
      type: "exec",
      payload: { command: process.execPath, args: [fixture("sleep.js"), "5000"] },
      maxAttempts: 3,
    });

    void worker.start();
    await waitFor(() => queue.getById(job.id)?.state === "RUNNING", "job to start");
    await queue.cancelJob(job.id);

    await new Promise((resolve) => setTimeout(resolve, 150));
    const settled = queue.getById(job.id);
    expect(settled?.state).toBe("CANCELLED");
    expect(settled?.attempts).toBe(0);
    expect(runningJobs.size).toBe(0);
  });

  it("flips a pending job straight to CANCELLED with no signal", async () => {
    const job = queue.enqueue({
      type: "exec",
      payload: { command: "echo", args: ["never runs"] },
    });

    const result = await queue.cancelJob(job.id);
    expect(result).toEqual({ jobId: job.id, signal: "NONE", wasRunning: false });
    expect(queue.getById(job.id)?.state).toBe("CANCELLED");
  });

  it("cancels a claimed-but-not-started job and frees its worker row", async () => {
    const job = queue.enqueue({
      type: "exec",
      payload: { command: "echo", args: ["claimed"] },
    });
    queue.registerWorker("manual-worker");
    const claimed = queue.claimNext("manual-worker");
    expect(claimed?.state).toBe("CLAIMED");

    const result = await queue.cancelJob(job.id);
    expect(result.wasRunning).toBe(false);
    expect(queue.getById(job.id)?.state).toBe("CANCELLED");
    expect(queue.getWorkers()[0]?.claimedJobId).toBeNull();
  });
});
