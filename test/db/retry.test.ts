import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { Queue } from "../../src/db/queue.js";
import { testConfig, testQueue } from "../helpers.js";

const config = testConfig({ baseBackoffMs: 10 });

describe("Retry ladder, dead letter and requeue", () => {
  let db: Database.Database;
  let queue: Queue;

  beforeEach(() => {
    ({ db, queue } = testQueue(config));
  });

  afterAll(() => {
    db.close();
  });

  it("leaves a job FAILED with backoff after one failed attempt when attempts < maxAttempts", () => {
    queue.registerWorker("w1");
    const job = queue.enqueue({ type: "echo", payload: {}, maxAttempts: 3 });
    queue.claimNext("w1");
    queue.startJob(job.id, "w1");

    const failed = queue.failJob(job.id, "w1", "oops");

    expect(failed?.state).toBe("FAILED");
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError).toBe("oops");
    expect(failed?.errorTrail).toEqual(["oops"]);
    expect(failed?.runAfter).toBeGreaterThan(Date.now());
  });

  it("moves a job to DEAD_LETTER when attempts reach maxAttempts", async () => {
    queue.registerWorker("w1");
    const job = queue.enqueue({ type: "echo", payload: {}, maxAttempts: 3 });
    queue.claimNext("w1");
    queue.startJob(job.id, "w1");
    let failed = queue.failJob(job.id, "w1", "error-1");
    expect(failed?.state).toBe("FAILED");

    // Wait for backoff to expire so the job becomes claimable again
    await new Promise((r) => setTimeout(r, 100));

    queue.claimNext("w1");
    queue.startJob(job.id, "w1");
    failed = queue.failJob(job.id, "w1", "error-2");
    expect(failed?.state).toBe("FAILED");

    await new Promise((r) => setTimeout(r, 100));

    queue.claimNext("w1");
    queue.startJob(job.id, "w1");
    const dl = queue.failJob(job.id, "w1", "error-3");

    expect(dl?.state).toBe("DEAD_LETTER");
    expect(dl?.attempts).toBe(3);
    expect(dl?.finishedAt).toBeDefined();
    expect(dl?.errorTrail).toEqual(["error-1", "error-2", "error-3"]);
  });

  it("requeueDeadLetter resets a DEAD_LETTER job to PENDING with attempts 0", () => {
    queue.registerWorker("w1");
    const job = queue.enqueue({ type: "echo", payload: {}, maxAttempts: 1 });
    queue.claimNext("w1");
    queue.startJob(job.id, "w1");
    const failed = queue.failJob(job.id, "w1", "boom");

    expect(failed?.state).toBe("DEAD_LETTER");

    const requeued = queue.requeueDeadLetter(job.id);
    expect(requeued?.state).toBe("PENDING");
    expect(requeued?.attempts).toBe(0);
    expect(requeued?.runAfter).toBeNull();

    const claimed = queue.claimNext("w1");
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(job.id);
  });

  it("requeueDeadLetter returns null for a non-DEAD_LETTER job", () => {
    queue.enqueue({ type: "echo", payload: {} });
    const result = queue.requeueDeadLetter(1);
    expect(result).toBeNull();

    const job = queue.getById(1);
    expect(job?.state).toBe("PENDING");
  });

  it("getStats reports correct counts across a mixed set of jobs", () => {
    queue.registerWorker("w1");

    // Enqueue and complete a job so it shows as succeeded
    const succeedJob = queue.enqueue({ type: "echo", payload: {} });
    queue.claimNext("w1");
    queue.startJob(succeedJob.id, "w1");
    queue.completeJob(succeedJob.id, "w1");

    // Enqueue and dead-letter a job
    const dlJob = queue.enqueue({ type: "echo", payload: {}, maxAttempts: 1 });
    queue.claimNext("w1");
    queue.startJob(dlJob.id, "w1");
    queue.failJob(dlJob.id, "w1", "fatal");

    // Leave one more job pending so stats show all three states
    queue.enqueue({ type: "echo", payload: {} });

    const stats = queue.getStats();
    expect(stats.pending).toBeGreaterThanOrEqual(1);
    expect(stats.succeeded).toBe(1);
    expect(stats.deadLetter).toBeGreaterThanOrEqual(1);
  });
});
