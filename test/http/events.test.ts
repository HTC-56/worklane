import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import type { TestApp } from "../helpers.js";
import { listenTestApp, readLedger, readSseEvents, scratchDir, testApp } from "../helpers.js";

describe("SSE stream and JSONL ledger", () => {
  let t: TestApp;
  const apps: TestApp[] = [];
  let scratch: { path: string; cleanup: () => void };

  beforeEach(() => {
    t = testApp();
    apps.push(t);
  });

  afterEach(async () => {
    await Promise.all(apps.map((a) => a.close()));
    scratch?.cleanup();
  });

  it("enqueuing two jobs on the SSE stream yields two enqueued events with correct ids", async () => {
    const url = await listenTestApp(t);
    const events = await readSseEvents(`${url}/events?replay=0`, {
      count: 2,
      token: t.config.bearerToken,
      timeoutMs: 5_000,
      onOpen: async () => {
        t.queue.enqueue({ type: "exec", payload: { command: "true" } });
        t.queue.enqueue({ type: "exec", payload: { command: "true" } });
      },
    });
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("enqueued");
    expect(events[1].kind).toBe("enqueued");
    expect(events[0].data.jobId).toBeTypeOf("number");
    expect(events[1].data.jobId).toBeTypeOf("number");
    expect(events[0].data.jobId).not.toBe(events[1].data.jobId);
  });

  it("driving a job to cancelled yields a cancelled event with state CANCELLED", async () => {
    const url = await listenTestApp(t);
    const events = await readSseEvents(`${url}/events?replay=0`, {
      count: 2,
      token: t.config.bearerToken,
      timeoutMs: 5_000,
      onOpen: async () => {
        const r = t.queue.enqueue({ type: "exec", payload: { command: "true" } });
        t.queue.cancelJob(r.id);
      },
    });
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("enqueued");
    expect(events[1].kind).toBe("cancelled");
    expect(events[1].data.state).toBe("CANCELLED");
  });

  it("replay=5 on a bus that already saw events returns them without new work", async () => {
    // Enqueue and cancel so the bus has history
    t.queue.enqueue({ type: "exec", payload: { command: "true" } });
    const r = t.queue.enqueue({ type: "exec", payload: { command: "true" } });
    t.queue.cancelJob(r.id);

    const url = await listenTestApp(t);
    const events = await readSseEvents(`${url}/events?replay=5`, {
      count: 3,
      token: t.config.bearerToken,
      timeoutMs: 5_000,
    });
    expect(events).toHaveLength(3);
    expect(events[0].kind).toBe("enqueued");
    expect(events[1].kind).toBe("enqueued");
    expect(events[2].kind).toBe("cancelled");
  });

  it("ledger file contains enqueued and cancelled entries with ts and jobId", async () => {
    scratch = scratchDir();
    const ledgerPath = join(scratch.path, "ledger.jsonl");

    const ledgerT = testApp({ ledgerPath });
    apps.push(ledgerT);

    ledgerT.queue.enqueue({ type: "exec", payload: { command: "true" } });
    const r = ledgerT.queue.enqueue({ type: "exec", payload: { command: "true" } });
    ledgerT.queue.cancelJob(r.id);

    await ledgerT.app.close();

    const entries = readLedger(ledgerPath);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("enqueued");
    expect(kinds).toContain("cancelled");
    const enqueued = entries.find((e) => e.kind === "enqueued");
    const cancelled = entries.find((e) => e.kind === "cancelled");
    expect(enqueued).toBeDefined();
    expect(cancelled).toBeDefined();
    expect(enqueued!.ts).toBeTypeOf("number");
    expect(cancelled!.ts).toBeTypeOf("number");
    expect(enqueued!.jobId).toBeTypeOf("number");
    expect(cancelled!.jobId).toBeTypeOf("number");
  });
});
