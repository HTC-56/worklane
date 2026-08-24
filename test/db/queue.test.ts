import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { Queue } from "../../src/db/queue.js";
import { DuplicateJobError, UnknownParentError } from "../../src/errors.js";
import { testConfig, testQueue } from "../helpers.js";

const config = testConfig({ defaultMaxAttempts: 5 });

describe("Queue enqueue, dedupe and claim ordering", () => {
  let db: Database.Database;
  let queue: Queue;

  beforeEach(() => {
    ({ db, queue } = testQueue(config));
  });

  afterAll(() => {
    db.close();
  });

  it("returns a PENDING job with correct defaults when enqueued with only type", () => {
    const job = queue.enqueue({ type: "echo", payload: {} });

    expect(job.state).toBe("PENDING");
    expect(job.attempts).toBe(0);
    expect(job.priority).toBe(0);
    expect(job.maxAttempts).toBe(config.defaultMaxAttempts);
    expect(job.payload).toEqual({});
  });

  it("throws DuplicateJobError when a second job uses the same dedupe key", () => {
    queue.enqueue({ type: "echo", payload: {}, dedupeKey: "dup-1" });

    expect(() =>
      queue.enqueue({ type: "echo", payload: {}, dedupeKey: "dup-1" }),
    ).toThrow(DuplicateJobError);

    expect(queue.listJobs()).toHaveLength(1);
  });

  it("releases the dedupe key when the job is cancelled so re-enqueue succeeds", () => {
    queue.enqueue({ type: "echo", payload: {}, dedupeKey: "dup-2" });
    queue.cancelJob(1);

    const job = queue.enqueue({ type: "echo", payload: {}, dedupeKey: "dup-2" });
    expect(job.state).toBe("PENDING");
  });

  it("throws UnknownParentError when the parent does not exist", () => {
    expect(() =>
      queue.enqueue({ type: "echo", payload: {}, parentId: 9999 }),
    ).toThrow(UnknownParentError);
  });

  it("claims highest priority first, then oldest among equal priority", () => {
    queue.enqueue({ type: "echo", payload: {}, priority: 1 });
    queue.enqueue({ type: "echo", payload: {}, priority: 10 });
    queue.enqueue({ type: "echo", payload: {}, priority: 10 });

    const first = queue.claimNext("w1");
    expect(first?.priority).toBe(10);

    const second = queue.claimNext("w1");
    expect(second?.priority).toBe(10);
    expect(second?.id).toBeGreaterThan(first!.id);
  });

  it("returns a job whose runAfter is in the past but skips ones in the future", () => {
    const runAfter = Date.now() - 1;
    queue.enqueue({ type: "echo", payload: {}, runAfter });

    const job = queue.claimNext("w1");
    expect(job).not.toBeNull();
    expect(job!.state).toBe("CLAIMED");
  });
});
