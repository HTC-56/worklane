import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { Queue } from "../../src/db/queue.js";
import { testConfig, testQueue } from "../helpers.js";

const config = testConfig({ defaultMaxAttempts: 5 });

describe("Queue chains — cancelling a job cancels its children", () => {
  let db: Database.Database;
  let queue: Queue;

  beforeEach(() => {
    ({ db, queue } = testQueue(config));
  });

  afterAll(() => {
    db.close();
  });

  it("cancelling a PENDING parent leaves both of its children CANCELLED", async () => {
    const parent = queue.enqueue({ type: "parent", payload: {} });
    queue.enqueue({ type: "child-1", payload: {}, parentId: parent.id });
    queue.enqueue({ type: "child-2", payload: {}, parentId: parent.id });

    await queue.cancelJob(parent.id);

    const c1 = queue.getById(
      queue.listChildren(parent.id).find((c) => c.type === "child-1")!.id,
    );
    const c2 = queue.getById(
      queue.listChildren(parent.id).find((c) => c.type === "child-2")!.id,
    );
    expect(c1?.state).toBe("CANCELLED");
    expect(c2?.state).toBe("CANCELLED");
  });

  it("each cancelled child's lastError mentions its parent's id", async () => {
    const parent = queue.enqueue({ type: "parent", payload: {} });
    queue.enqueue({ type: "child", payload: {}, parentId: parent.id });
    await queue.cancelJob(parent.id);
    const child = queue.listChildren(parent.id)[0];
    expect(child?.lastError).toContain(String(parent.id));
  });

  it("a child that had already SUCCEEDED is untouched when the parent is cancelled", async () => {
    const parent = queue.enqueue({ type: "parent", payload: {} });
    const child = queue.enqueue({ type: "child", payload: {}, parentId: parent.id });

    // Drive parent to SUCCEEDED so child becomes claimable
    queue.claimNext("w1");
    queue.startJob(parent.id, "w1");
    queue.completeJob(parent.id, "w1");

    // Now drive child to SUCCEEDED
    queue.claimNext("w1");
    queue.startJob(child.id, "w1");
    queue.completeJob(child.id, "w1");

    await queue.cancelJob(parent.id);

    const stillAlive = queue.getById(child.id);
    expect(stillAlive?.state).toBe("SUCCEEDED");
  });

  it("cancelling a job with no children still works and returns wasRunning: false", async () => {
    const orphan = queue.enqueue({ type: "lonely", payload: {} });
    const result = await queue.cancelJob(orphan.id);
    expect(result.wasRunning).toBe(false);
    expect(result.signal).toBe("NONE");
    const updated = queue.getById(orphan.id);
    expect(updated?.state).toBe("CANCELLED");
    expect(queue.listChildren(orphan.id)).toHaveLength(0);
  });
});
