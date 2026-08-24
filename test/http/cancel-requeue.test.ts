import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TestApp } from "../helpers.js";
import { testApp } from "../helpers.js";

describe("HTTP cancel and requeue", () => {
  let t: TestApp;
  const apps: TestApp[] = [];

  beforeEach(() => {
    t = testApp();
    apps.push(t);
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it("POST /jobs/:id/cancel on a PENDING job answers 200 with wasRunning:false and signal:NONE, job is CANCELLED", async () => {
    const enq = await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: { type: "exec", payload: { command: "true" } },
    });
    const id = JSON.parse(enq.body).job.id;

    const r = await t.app.inject({
      method: "POST",
      url: `/jobs/${id}/cancel`,
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.result.wasRunning).toBe(false);
    expect(body.result.signal).toBe("NONE");
    expect(body.job.state).toBe("CANCELLED");
  });

  it("POST /jobs/:id/cancel on a missing id answers 404", async () => {
    const r = await t.app.inject({
      method: "POST",
      url: "/jobs/99999/cancel",
    });
    expect(r.statusCode).toBe(404);
    const body = JSON.parse(r.body);
    expect(typeof body.error).toBe("string");
  });

  it("POST /jobs/:id/requeue on a DEAD_LETTER job answers 200 with PENDING and attempts:0", async () => {
    const enq = await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: { type: "exec", payload: { command: "true" } },
    });
    const id = JSON.parse(enq.body).job.id;

    // Drive the job to DEAD_LETTER via the raw database — no workers run
    // in testApp, so we must flip the state directly.
    t.db
      .prepare(
        `UPDATE jobs
           SET state = 'DEAD_LETTER', attempts = 1, last_error = 'test error',
               error_trail = '["test error"]',
               updated_at = ?, finished_at = ?, lease_until = NULL,
               worker_id = NULL, run_after = NULL
         WHERE id = ?`,
      )
      .run(Date.now(), Date.now(), id);

    const r = await t.app.inject({
      method: "POST",
      url: `/jobs/${id}/requeue`,
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.job.state).toBe("PENDING");
    expect(body.job.attempts).toBe(0);
  });

  it("POST /jobs/:id/requeue on non-DEAD_LETTER answers 409; on unknown id answers 404", async () => {
    const enq = await t.app.inject({
      method: "POST",
      url: "/jobs",
      payload: { type: "exec", payload: { command: "true" } },
    });
    const id = JSON.parse(enq.body).job.id;

    // PENDING job cannot be requeued
    const r1 = await t.app.inject({
      method: "POST",
      url: `/jobs/${id}/requeue`,
    });
    expect(r1.statusCode).toBe(409);
    const body1 = JSON.parse(r1.body);
    expect(typeof body1.error).toBe("string");

    // Verify state is still PENDING (unchanged)
    const inspect = await t.app.inject({
      method: "GET",
      url: `/jobs/${id}`,
    });
    expect(JSON.parse(inspect.body).job.state).toBe("PENDING");

    // Unknown id → 404
    const r2 = await t.app.inject({
      method: "POST",
      url: "/jobs/99999/requeue",
    });
    expect(r2.statusCode).toBe(404);
  });
});
