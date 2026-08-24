import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { Queue } from "../../src/db/queue.js";
import { createExecHandler } from "../../src/handlers/exec.js";
import { createWorker, type Worker } from "../../src/workers/worker.js";
import type { RunningJobs } from "../../src/workers/running-jobs.js";
import type { Config, Handler } from "../../src/types.js";
import { fixture, testConfig, testQueue, waitFor } from "../helpers.js";

const config: Config = testConfig({ defaultMaxAttempts: 3 });

describe("worker claim loop", () => {
  let db: Database.Database;
  let queue: Queue;
  let runningJobs: RunningJobs;
  let worker: Worker;
  let handlers: Map<string, Handler>;

  beforeEach(() => {
    ({ db, queue, runningJobs } = testQueue(config));
    handlers = new Map<string, Handler>([["exec", createExecHandler(config)]]);
    worker = createWorker({ queue, handlers, config, workerId: "worker-1", runningJobs });
  });

  afterEach(async () => {
    await worker.stop();
    db.close();
  });

  it("claims a pending job, runs it, and marks it SUCCEEDED", async () => {
    const job = queue.enqueue({
      type: "exec",
      payload: { command: "echo", args: ["done"] },
    });
    expect(job.state).toBe("PENDING");

    void worker.start();
    await waitFor(() => queue.getById(job.id)?.state === "SUCCEEDED", "job to succeed");

    const finished = queue.getById(job.id);
    expect(finished?.stdoutTail).toBe("done\n");
    expect(finished?.workerId).toBeNull();
    expect(finished?.finishedAt).toBeGreaterThan(0);
  });

  it("extends the lease while the job runs", async () => {
    const job = queue.enqueue({
      type: "exec",
      payload: { command: process.execPath, args: [fixture("sleep.js"), "600"] },
    });

    void worker.start();
    await waitFor(() => queue.getById(job.id)?.state === "RUNNING", "job to start");
    const firstLease = queue.getById(job.id)?.leaseUntil ?? 0;

    await waitFor(
      () => (queue.getById(job.id)?.leaseUntil ?? 0) > firstLease,
      "the lease to be extended",
    );
  });

  it("schedules a retry with backoff when the handler fails", async () => {
    const job = queue.enqueue({
      type: "exec",
      payload: { command: process.execPath, args: [fixture("fail.js"), "3"] },
      maxAttempts: 3,
    });

    void worker.start();
    await waitFor(() => (queue.getById(job.id)?.attempts ?? 0) >= 1, "the first attempt");

    const afterFailure = queue.getById(job.id);
    expect(afterFailure?.attempts).toBeGreaterThanOrEqual(1);
    expect(afterFailure?.lastError).toContain("exited with code 3");
    expect(afterFailure?.errorTrail.length).toBeGreaterThanOrEqual(1);
  });

  it("dead-letters a job whose type has no registered handler", async () => {
    const job = queue.enqueue({ type: "no-such-type", payload: {} });

    void worker.start();
    await waitFor(
      () => queue.getById(job.id)?.state === "DEAD_LETTER",
      "the job to dead-letter",
    );

    expect(queue.getById(job.id)?.lastError).toContain("no handler registered");
  });

  it("hands the in-flight job back to the queue on stop, then unregisters", async () => {
    const job = queue.enqueue({
      type: "exec",
      payload: { command: process.execPath, args: [fixture("sleep.js"), "5000"] },
    });

    void worker.start();
    await waitFor(() => queue.getById(job.id)?.state === "RUNNING", "job to start");
    await worker.stop();

    const released = queue.getById(job.id);
    expect(released?.state).toBe("PENDING");
    expect(released?.attempts).toBe(0);
    expect(released?.workerId).toBeNull();
    expect(queue.getWorkers()).toHaveLength(0);
  });

  it("runs the highest-priority job first", async () => {
    const order: number[] = [];
    handlers.set("record", {
      type: "record",
      async handle(payload) {
        order.push(Number(payload.n));
      },
    });

    const low = queue.enqueue({ type: "record", payload: { n: 1 }, priority: 0 });
    const high = queue.enqueue({ type: "record", payload: { n: 2 }, priority: 10 });

    void worker.start();
    await waitFor(() => order.length === 2, "both jobs to run");

    expect(order).toEqual([2, 1]);
    expect(queue.getById(high.id)?.state).toBe("SUCCEEDED");
    expect(queue.getById(low.id)?.state).toBe("SUCCEEDED");
  });
});
