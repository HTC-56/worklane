import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { Queue } from "../../src/db/queue.js";
import { testConfig, testQueue } from "../helpers.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Lease lapse returns a job to the queue", () => {
  let db: Database.Database;
  let queue: Queue;

  beforeEach(() => {
    const config = testConfig({ leaseDurationMs: 5, defaultMaxAttempts: 5 });
    ({ db, queue } = testQueue(config));
  });

  afterAll(() => {
    db.close();
  });

  it("a lapsed lease is reclaimed as PENDING with workerId and leaseUntil null", async () => {
    queue.registerWorker("w1");
    const job = queue.enqueue({ type: "echo", payload: {} });
    const claimed = queue.claimNext("w1");
    expect(claimed?.state).toBe("CLAIMED");

    await sleep(30);

    const reclaimed = queue.releaseStaleLeases();
    expect(reclaimed).toBe(1);

    const refreshed = queue.listJobs().find((j) => j.id === job.id);
    expect(refreshed?.state).toBe("PENDING");
    expect(refreshed?.workerId).toBeNull();
    expect(refreshed?.leaseUntil).toBeNull();
  });

  it("reclaiming a lapsed lease does not change attempts", async () => {
    queue.registerWorker("w1");
    const job = queue.enqueue({ type: "echo", payload: {} });
    queue.claimNext("w1");

    await sleep(30);
    queue.releaseStaleLeases();

    const refreshed = queue.listJobs().find((j) => j.id === job.id);
    expect(refreshed?.attempts).toBe(0);
  });

  it("the worker row gets claimedJobId back to null", async () => {
    queue.registerWorker("w1");
    queue.enqueue({ type: "echo", payload: {} });
    queue.claimNext("w1");

    await sleep(30);
    queue.releaseStaleLeases();

    const workers = queue.getWorkers();
    const w1 = workers.find((w) => w.id === "w1");
    expect(w1?.claimedJobId).toBeNull();
  });

  it("with a long lease releaseStaleLeases returns 0 and heartbeat extends leaseUntil", async () => {
    const longConfig = testConfig({ leaseDurationMs: 5000, defaultMaxAttempts: 5 });
    ({ db, queue } = testQueue(longConfig));

    queue.registerWorker("w1");
    queue.enqueue({ type: "echo", payload: {} });
    const claimed = queue.claimNext("w1");
    expect(claimed?.state).toBe("CLAIMED");

    const before = queue.listJobs().find((j) => j.id === claimed!.id);
    expect(before?.leaseUntil).not.toBeNull();

    const stale = queue.releaseStaleLeases();
    expect(stale).toBe(0);

    const stillClaimed = queue.listJobs().find((j) => j.id === claimed!.id);
    expect(stillClaimed?.state).toBe("CLAIMED");

    await sleep(5);
    queue.heartbeat("w1", claimed!.id);

    const after = queue.listJobs().find((j) => j.id === claimed!.id);
    expect(after?.leaseUntil).toBeGreaterThan(before!.leaseUntil!);
  });
});
