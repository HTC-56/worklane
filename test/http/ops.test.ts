import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TestApp } from "../helpers.js";
import { testApp } from "../helpers.js";

describe("healthz, stats and Prometheus metrics", () => {
  let t: TestApp;
  const apps: TestApp[] = [];

  beforeEach(() => {
    t = testApp();
    apps.push(t);

    // Enqueue a small mixed set so counts are not all zero.
    t.queue.enqueue({ type: "exec", payload: { command: "true" }, dedupeKey: "h1" });
    t.queue.enqueue({ type: "exec", payload: { command: "true" }, dedupeKey: "h2" });
    t.queue.enqueue({ type: "custom", payload: {}, dedupeKey: "h3" });
    const cancelledJob = t.queue.enqueue({ type: "exec", payload: {}, dedupeKey: "h4" });
    t.queue.markCancelled(cancelledJob.id, "test-worker", { signal: new AbortController().signal, graceMs: 0 });
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it("GET /healthz answers 200 with ok, uptimeMs, schemaVersion and stats", async () => {
    const r = await t.app.inject({ method: "GET", url: "/healthz" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.uptimeMs).toBeTypeOf("number");
    expect(body.schemaVersion).toBe(1);
    expect(body.stats).toBeTypeOf("object");
  });

  it("GET /metrics answers 200 with text/plain content-type", async () => {
    const r = await t.app.inject({ method: "GET", url: "/metrics" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/plain/);
  });

  it("The metrics body contains # TYPE worklane_jobs gauge and a pending line matching the queue", async () => {
    const r = await t.app.inject({ method: "GET", url: "/metrics" });
    const body = r.body;
    expect(body).toContain("# TYPE worklane_jobs gauge");
    const pendingLine = body
      .split("\n")
      .find((l: string) => l.startsWith('worklane_jobs{state="pending"}'));
    expect(pendingLine).toBeDefined();
    const expected = t.queue.getStats().pending;
    expect(pendingLine).toContain(` ${expected}`);
  });

  it("The metrics body contains worklane_jobs_by_type for exec and a worklane_workers line", async () => {
    const r = await t.app.inject({ method: "GET", url: "/metrics" });
    const body = r.body;
    expect(body).toContain('worklane_jobs_by_type{type="exec",state="pending"}');
    expect(body).toContain("worklane_workers ");
  });

  it("GET /stats answers 200 with stats, byType containing exec, workers and throughputWindowMs", async () => {
    const r = await t.app.inject({ method: "GET", url: "/stats" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.stats).toBeTypeOf("object");
    expect(Array.isArray(body.byType)).toBe(true);
    expect(body.byType.some((e: { type: string }) => e.type === "exec")).toBe(true);
    expect(Array.isArray(body.workers)).toBe(true);
    expect(body.throughputWindowMs).toBeTypeOf("number");
  });
});
