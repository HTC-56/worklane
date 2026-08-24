import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestApp } from "../helpers.js";
import { listenTestApp, readSseEvents, testApp } from "../helpers.js";

describe("Live progress, the way the progress bars read it", () => {
  let t: TestApp;
  const apps: TestApp[] = [];

  beforeEach(() => {
    t = testApp();
    apps.push(t);
  });

  afterEach(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it("GET /jobs/:id returns progress fields after updateProgress", async () => {
    // Drive a job to RUNNING by hand
    t.queue.registerWorker("w1");
    const enqueueResult = t.queue.enqueue({ type: "demo", payload: {} });
    const claimed = t.queue.claimNext("w1");
    expect(claimed?.id).toBe(enqueueResult.id);
    t.queue.startJob(enqueueResult.id, "w1");
    t.queue.updateProgress(enqueueResult.id, "w1", 3, 10, "step 3 of 10");

    const url = await listenTestApp(t);
    const r = await t.app.inject({
      method: "GET",
      url: `/jobs/${enqueueResult.id}`,
      headers: t.auth,
    });

    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.job.progressDone).toBe(3);
    expect(body.job.progressTotal).toBe(10);
    expect(body.job.progressNote).toBe("step 3 of 10");
  });

  it("GET /stats running array carries progress fields and workerId", async () => {
    t.queue.registerWorker("w1");
    const enqueueResult = t.queue.enqueue({ type: "demo", payload: {} });
    t.queue.claimNext("w1");
    t.queue.startJob(enqueueResult.id, "w1");
    t.queue.updateProgress(enqueueResult.id, "w1", 3, 10, "step 3 of 10");

    const url = await listenTestApp(t);
    const r = await t.app.inject({
      method: "GET",
      url: "/stats",
      headers: t.auth,
    });

    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.running).toHaveLength(1);
    expect(body.running[0].progressDone).toBe(3);
    expect(body.running[0].progressTotal).toBe(10);
    expect(body.running[0].progressNote).toBe("step 3 of 10");
    expect(body.running[0].workerId).toBe("w1");
  });

  it("later updateProgress moves the bar — GET /stats reflects the new value", async () => {
    t.queue.registerWorker("w1");
    const enqueueResult = t.queue.enqueue({ type: "demo", payload: {} });
    t.queue.claimNext("w1");
    t.queue.startJob(enqueueResult.id, "w1");
    t.queue.updateProgress(enqueueResult.id, "w1", 3, 10, "step 3 of 10");

    const url = await listenTestApp(t);

    // First check: progressDone is 3
    const r1 = await t.app.inject({
      method: "GET",
      url: "/stats",
      headers: t.auth,
    });
    expect(JSON.parse(r1.body).running[0].progressDone).toBe(3);

    // Advance progress
    t.queue.updateProgress(enqueueResult.id, "w1", 7, 10, "step 7 of 10");

    // Second check: progressDone is now 7
    const r2 = await t.app.inject({
      method: "GET",
      url: "/stats",
      headers: t.auth,
    });
    expect(JSON.parse(r2.body).running[0].progressDone).toBe(7);
  });

  it("an updateProgress over SSE yields a progress event with the correct jobId", async () => {
    t.queue.registerWorker("w1");
    const enqueueResult = t.queue.enqueue({ type: "demo", payload: {} });
    t.queue.claimNext("w1");
    t.queue.startJob(enqueueResult.id, "w1");

    const url = await listenTestApp(t);

    const events = await readSseEvents(`${url}/events?replay=0`, {
      count: 1,
      token: t.config.bearerToken,
      timeoutMs: 5_000,
      onOpen: async () => {
        t.queue.updateProgress(enqueueResult.id, "w1", 5, 10, "halfway");
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("progress");
    expect(events[0].data.jobId).toBe(enqueueResult.id);
  });
});
