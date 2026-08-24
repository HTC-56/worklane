import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TestApp } from "../helpers.js";
import { testApp } from "../helpers.js";

describe("the worker lease table", () => {
  let t: TestApp;
  const apps: TestApp[] = [];

  beforeEach(() => {
    t = testApp();
    apps.push(t);
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it("On a fresh testApp(), GET /stats answers with an empty workers array", async () => {
    const r = await t.app.inject({ method: "GET", url: "/stats" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(Array.isArray(body.workers)).toBe(true);
    expect(body.workers).toHaveLength(0);
  });

  it("After queue.registerWorker(\"w1\"), GET /stats has exactly one worker with id, startedAt, lastHeartbeat and null claimedJobId", async () => {
    t.queue.registerWorker("w1");
    const r = await t.app.inject({ method: "GET", url: "/stats" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.workers).toHaveLength(1);
    const w = body.workers[0];
    expect(w.id).toBe("w1");
    expect(w.startedAt).toBeTypeOf("number");
    expect(w.lastHeartbeat).toBeTypeOf("number");
    expect(w.claimedJobId).toBeNull();
  });

  it("After claiming and completing a job, the worker's claimedJobId is null again", async () => {
    t.queue.registerWorker("w1");
    const job = t.queue.enqueue({ type: "exec", payload: { command: "true" }, dedupeKey: "wjob" });
    const claimed = t.queue.claimNext("w1");
    expect(claimed).toBeDefined();
    expect(claimed!.id).toBe(job.id);

    let r = await t.app.inject({ method: "GET", url: "/stats" });
    const bodyBefore = JSON.parse(r.body);
    expect(bodyBefore.workers[0].claimedJobId).toBe(job.id);

    t.queue.startJob(job.id, "w1");
    t.queue.completeJob(job.id, "w1");

    r = await t.app.inject({ method: "GET", url: "/stats" });
    const bodyAfter = JSON.parse(r.body);
    expect(bodyAfter.workers[0].claimedJobId).toBeNull();
  });

  it("GET /metrics contains worklane_workers gauges that reflect busy state", async () => {
    t.queue.registerWorker("w1");
    const rIdle = await t.app.inject({ method: "GET", url: "/metrics" });
    expect(rIdle.statusCode).toBe(200);
    expect(rIdle.body).toContain("worklane_workers 1");

    const job = t.queue.enqueue({ type: "exec", payload: { command: "true" }, dedupeKey: "wjob2" });
    t.queue.claimNext("w1");
    t.queue.startJob(job.id, "w1");

    const rBusy = await t.app.inject({ method: "GET", url: "/metrics" });
    const busyLines = rBusy.body
      .split("\n")
      .filter((l: string) => l.startsWith("worklane_workers_busy"));
    expect(busyLines.length).toBeGreaterThan(0);
    expect(busyLines[0].trim()).toMatch(/worklane_workers_busy 1$/);

    t.queue.completeJob(job.id, "w1");

    const rDone = await t.app.inject({ method: "GET", url: "/metrics" });
    const doneLines = rDone.body
      .split("\n")
      .filter((l: string) => l.startsWith("worklane_workers_busy"));
    expect(doneLines[0].trim()).toMatch(/worklane_workers_busy 0$/);
  });
});
