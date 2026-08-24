import { describe, expect, it } from "vitest";
import { createDemoHandler } from "../../src/handlers/demo.js";
import { JobCancelledError } from "../../src/errors.js";
import { testContext } from "../helpers.js";

const handler = createDemoHandler();
const { handle } = handler;

describe("demo handler", () => {
  it("walks the configured steps and reports progress", async () => {
    const { ctx, controller, captured } = testContext();
    await handle({ steps: 3, stepMs: 5 }, ctx);
    expect(captured.progress).toHaveLength(3);
    controller.abort();
  });

  it("last update has done=3, total=3, and note mentions step 3", async () => {
    const { ctx, controller, captured } = testContext();
    await handle({ steps: 3, stepMs: 5 }, ctx);
    const last = captured.progress[2] as Record<string, unknown>;
    expect(last.done).toBe(3);
    expect(last.total).toBe(3);
    expect(typeof last.note).toBe("string");
    expect(String(last.note)).toContain("3");
    controller.abort();
  });

  it("aborting before handle rejects with JobCancelledError", async () => {
    const { ctx, controller } = testContext();
    controller.abort();
    await expect(handle({ steps: 3, stepMs: 5 }, ctx)).rejects.toThrow(JobCancelledError);
  });

  it("type is demo, and empty payload uses defaults", async () => {
    expect(handler.type).toBe("demo");
    const { ctx, controller } = testContext();
    controller.abort();
    // Should reject with JobCancelledError, not a Zod validation error
    await expect(handle({}, ctx)).rejects.toThrow(JobCancelledError);
  });
});
