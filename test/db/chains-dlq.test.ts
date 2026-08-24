import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { Queue } from "../../src/db/queue.js";
import { testConfig, testQueue } from "../helpers.js";

const config = testConfig({ defaultMaxAttempts: 1 });

describe("Queue chains — dead-lettering a job dead-letters its children", () => {
  let db: Database.Database;
  let queue: Queue;

  beforeEach(() => {
    ({ db, queue } = testQueue(config));
  });

  afterAll(() => {
    db.close();
  });

  it("a parent driven to DEAD_LETTER by exhausting maxAttempts: 1 leaves its child DEAD_LETTER", async () => {
    const parent = queue.enqueue({ type: "parent", payload: {} });
    const child = queue.enqueue({ type: "child", payload: {}, parentId: parent.id });

    queue.claimNext("w1");
    queue.startJob(parent.id, "w1");
    queue.failJob(parent.id, "w1", "boom");

    const deadChild = queue.getById(child.id);
    expect(deadChild?.state).toBe("DEAD_LETTER");
  });

  it("the child's lastError mentions its parent's id, and its errorTrail has the new entry", async () => {
    const parent = queue.enqueue({ type: "parent", payload: {} });
    const child = queue.enqueue({ type: "child", payload: {}, parentId: parent.id });

    queue.claimNext("w1");
    queue.startJob(parent.id, "w1");
    queue.failJob(parent.id, "w1", "boom");

    const deadChild = queue.getById(child.id);
    expect(deadChild?.lastError).toContain(String(parent.id));
    expect(deadChild?.errorTrail).toContain(`dead-lettered (parent ${parent.id})`);
  });

  it("a parent dead-lettered by deadLetterJob cascades the same way", async () => {
    const parent = queue.enqueue({ type: "parent", payload: {} });
    const child = queue.enqueue({ type: "child", payload: {}, parentId: parent.id });

    queue.claimNext("w1");
    queue.startJob(parent.id, "w1");
    queue.deadLetterJob(parent.id, "w1", "no handler");

    const deadChild = queue.getById(child.id);
    expect(deadChild?.state).toBe("DEAD_LETTER");
  });

  it("a child that already SUCCEEDED is untouched", async () => {
    const parent = queue.enqueue({ type: "parent", payload: {} });
    const child = queue.enqueue({ type: "child", payload: {}, parentId: parent.id });

    // Drive parent to SUCCEEDED so child becomes claimable
    queue.claimNext("w1");
    queue.startJob(parent.id, "w1");
    queue.completeJob(parent.id, "w1");

    // Drive child to SUCCEEDED
    queue.claimNext("w1");
    queue.startJob(child.id, "w1");
    queue.completeJob(child.id, "w1");

    // Now dead-letter parent
    queue.claimNext("w1");
    queue.startJob(parent.id, "w1");
    queue.deadLetterJob(parent.id, "w1", "no handler");

    const stillAlive = queue.getById(child.id);
    expect(stillAlive?.state).toBe("SUCCEEDED");
  });
});
