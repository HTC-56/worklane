import { z } from "zod";
import { JobCancelledError } from "../errors.js";
import type { Handler, HandlerContext } from "../types.js";

/** Input payload for the demo handler. */
export const DemoPayloadSchema = z.object({
  /** Number of progress steps to walk. */
  steps: z.number().int().positive().default(10),
  /** Milliseconds to wait between each step. */
  stepMs: z.number().int().positive().default(200),
});
export type DemoPayload = z.infer<typeof DemoPayloadSchema>;

/**
 * A demo handler that walks through a series of steps and reports progress.
 * It does no real work — just sleeps and calls `ctx.progress` so the
 * quickstart can show "enqueue demo jobs, watch progress".
 */
export function createDemoHandler(): Handler {
  return {
    type: "demo",
    async handle(payload: Record<string, unknown>, ctx: HandlerContext): Promise<void> {
      const { steps, stepMs } = DemoPayloadSchema.parse(payload);

      for (let i = 1; i <= steps; i += 1) {
        if (ctx.signal.aborted) {
          throw new JobCancelledError("NONE");
        }
        await new Promise((resolve) => setTimeout(resolve, stepMs));
        ctx.progress({
          done: i,
          total: steps,
          note: `step ${i} of ${steps}`,
        });
      }
    },
  };
}
