import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TestApp } from "../helpers.js";
import { testApp } from "../helpers.js";

describe("Dead-letter panel and its requeue button", () => {
  let t: TestApp;
  const apps: TestApp[] = [];

  beforeEach(() => {
    t = testApp();
    apps.push(t);
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it("GET /jobs?state=DEAD_LETTER lists only dead-lettered jobs with panel columns", async () => {
    // Enqueue one job that will dead-letter after one failure, plus one that stays PENDING
    const enq1 = await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: {
        type: "exec",
        payload: { command: "true" },
        maxAttempts: 1,
      },
    });
    expect(enq1.statusCode).toBe(201);
    const job1Id = JSON.parse(enq1.body).job.id;

    await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: { type: "exec", payload: { command: "true" } },
    });

    // Drive job1 to DEAD_LETTER: claim -> start -> failJob
    t.queue.claimNext("w1");
    t.queue.startJob(job1Id, "w1");
    t.queue.failJob(job1Id, "w1", "boom");

    // Assertion 1: DEAD_LETTER list has exactly one entry (not the PENDING job)
    const list = await t.app.inject({
      method: "GET",
      url: "/jobs?state=DEAD_LETTER",
    });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.body);
    expect(body.jobs.length).toBe(1);
    expect(body.jobs[0].id).toBe(job1Id);

    // Assertion 2: The entry carries the columns the panel prints
    const dlJob = body.jobs[0];
    expect(typeof dlJob.type).toBe("string");
    expect(typeof dlJob.attempts).toBe("number");
    expect(dlJob.maxAttempts).toBeTypeOf("number");
    expect(dlJob.lastError).toBeDefined();

    // Assertion 3: stats.deadLetter is 1
    expect(body.stats.deadLetter).toBe(1);
  });

  it("POST /jobs/:id/requeue flips DEAD_LETTER back to PENDING", async () => {
    // Enqueue and dead-letter a job
    const enq = await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: {
        type: "exec",
        payload: { command: "true" },
        maxAttempts: 1,
      },
    });
    expect(enq.statusCode).toBe(201);
    const jobId = JSON.parse(enq.body).job.id;

    t.queue.claimNext("w1");
    t.queue.startJob(jobId, "w1");
    t.queue.failJob(jobId, "w1", "boom");

    // Requeue the dead-lettered job
    await t.app.inject({
      method: "POST",
      url: `/jobs/${jobId}/requeue`,
    });

    // Assertion 4: DEAD_LETTER list is empty; job is PENDING again
    const listAfter = await t.app.inject({
      method: "GET",
      url: "/jobs?state=DEAD_LETTER",
    });
    expect(listAfter.statusCode).toBe(200);
    expect(JSON.parse(listAfter.body).jobs.length).toBe(0);

    const get = await t.app.inject({
      method: "GET",
      url: `/jobs/${jobId}`,
    });
    expect(get.statusCode).toBe(200);
    expect(JSON.parse(get.body).job.state).toBe("PENDING");
  });
});
