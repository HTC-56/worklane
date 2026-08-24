import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TestApp } from "../helpers.js";
import { testApp } from "../helpers.js";

describe("HTTP verbs — enqueue, inspect, dedupe, list", () => {
  let t: TestApp;
  const apps: TestApp[] = [];

  beforeEach(() => {
    t = testApp();
    apps.push(t);
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it("POST /jobs answers 201 with a PENDING job carrying id and priority", async () => {
    const r = await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: { type: "exec", payload: { command: "true" }, priority: 5 },
    });
    expect(r.statusCode).toBe(201);
    const body = JSON.parse(r.body);
    expect(body.job.id).toBeTypeOf("number");
    expect(body.job.state).toBe("PENDING");
    expect(body.job.priority).toBe(5);
  });

  it("GET /jobs/:id answers 200 with job and an empty children array", async () => {
    const enq = await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: { type: "exec", payload: { command: "true" } },
    });
    const id = JSON.parse(enq.body).job.id;

    const get = await t.app.inject({
      method: "GET",
      url: `/jobs/${id}`,
    });
    expect(get.statusCode).toBe(200);
    const body = JSON.parse(get.body);
    expect(body.job.id).toBe(id);
    expect(body.children).toEqual([]);
  });

  it("GET /jobs/:id for a missing id answers 404 with an error string", async () => {
    const r = await t.app.inject({
      method: "GET",
      url: "/jobs/99999",
    });
    expect(r.statusCode).toBe(404);
    const body = JSON.parse(r.body);
    expect(typeof body.error).toBe("string");
  });

  it("POST /jobs twice with the same dedupeKey answers 201 then 409", async () => {
    const first = await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: { type: "exec", payload: {}, dedupeKey: "dk-1" },
    });
    expect(first.statusCode).toBe(201);

    const second = await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: { type: "exec", payload: {}, dedupeKey: "dk-1" },
    });
    expect(second.statusCode).toBe(409);
    const body = JSON.parse(second.body);
    expect(body.existingJobId).toBeTypeOf("number");
  });

  it("POST /jobs with missing type or unknown parentId answers 400", async () => {
    const noType = await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: { payload: { command: "true" } },
    });
    expect(noType.statusCode).toBe(400);

    const badParent = await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: { type: "exec", payload: {}, parentId: 4242 },
    });
    expect(badParent.statusCode).toBe(400);
  });

  it("GET /jobs?state=PENDING filters and reports matching stats", async () => {
    // Enqueue via the queue directly so they hit the in-memory DB
    t.queue.enqueue({ type: "exec", payload: {}, dedupeKey: "s1" });
    t.queue.enqueue({ type: "exec", payload: {}, dedupeKey: "s2" });
    t.queue.enqueue({ type: "exec", payload: {}, dedupeKey: "s3" });

    const r = await t.app.inject({
      method: "GET",
      url: "/jobs?state=PENDING",
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.jobs.length).toBe(3);
    expect(body.jobs.every((j: { state: string }) => j.state === "PENDING")).toBe(
      true,
    );
    expect(body.stats.pending).toBe(body.jobs.length);
  });
});
