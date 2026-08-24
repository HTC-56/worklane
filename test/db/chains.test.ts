import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { Queue } from "../../src/db/queue.js";
import { testConfig, testQueue } from "../helpers.js";

const config = testConfig({ defaultMaxAttempts: 5 });

describe("Queue chains — child waits for parent", () => {
  let db: Database.Database;
  let queue: Queue;

  beforeEach(() => {
    ({ db, queue } = testQueue(config));
  });

  afterAll(() => {
    db.close();
  });

  it("claims the parent first; child is not claimable while parent is PENDING", () => {
    const parent = queue.enqueue({ type: "parent", payload: {} });
    queue.enqueue({ type: "child", payload: {}, parentId: parent.id });

    const first = queue.claimNext("w1");
    expect(first?.id).toBe(parent.id);

    const second = queue.claimNext("w1");
    expect(second).toBeNull();
  });

  it("claims the child once the parent is SUCCEEDED", async () => {
    const parent = queue.enqueue({ type: "parent", payload: {} });
    const child = queue.enqueue({ type: "child", payload: {}, parentId: parent.id });

    // Drive parent to SUCCEEDED
    queue.claimNext("w1");
    queue.startJob(parent.id, "w1");
    queue.completeJob(parent.id, "w1");

    const job = queue.claimNext("w1");
    expect(job?.id).toBe(child.id);
  });

  it("never claims a child whose parent was cancelled", () => {
    const parent = queue.enqueue({ type: "parent", payload: {} });
    queue.enqueue({ type: "child", payload: {}, parentId: parent.id });

    queue.claimNext("w1");
    queue.cancelJob(parent.id);

    const job = queue.claimNext("w1");
    expect(job).toBeNull();
  });

  it("listChildren returns direct children in id order and empty for no children", () => {
    const parent = queue.enqueue({ type: "parent", payload: {} });
    queue.enqueue({ type: "child-a", payload: {}, parentId: parent.id });
    queue.enqueue({ type: "child-b", payload: {}, parentId: parent.id });

    const children = queue.listChildren(parent.id);
    expect(children).toHaveLength(2);
    expect(children[0].id).toBeLessThan(children[1].id);

    const orphan = queue.enqueue({ type: "lonely", payload: {} });
    expect(queue.listChildren(orphan.id)).toHaveLength(0);
  });
});
