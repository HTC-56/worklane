import { spawn } from "node:child_process";
import { z } from "zod";
import { ExecFailedError, JobCancelledError } from "../errors.js";
import type { Config, Handler, HandlerContext, KillSignal } from "../types.js";

export const ExecPayloadSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  /** Explicit variables handed to the child. */
  env: z.record(z.string()).default({}),
  /** Names copied from this process's environment. Nothing else gets through. */
  envAllowlist: z.array(z.string()).default(["PATH"]),
  timeoutMs: z.number().int().positive().optional(),
  stdoutMaxBytes: z.number().int().positive().max(1_048_576).default(65_536),
  stderrMaxBytes: z.number().int().positive().max(1_048_576).default(65_536),
});
export type ExecPayload = z.infer<typeof ExecPayloadSchema>;

/** Keeps the last `maxBytes` of a stream — the tail is what you want in a log. */
function createTail(maxBytes: number) {
  let buf: Buffer = Buffer.alloc(0);
  return {
    push(chunk: Buffer): void {
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
      if (buf.length > maxBytes) buf = buf.subarray(buf.length - maxBytes);
    },
    text(): string {
      return buf.toString("utf8");
    },
  };
}

function buildEnv(payload: ExecPayload): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of payload.envAllowlist) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...payload.env };
}

function summarize(stderr: string, limit = 400): string {
  const trimmed = stderr.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return "";
  return ` — ${trimmed.slice(-limit)}`;
}

/**
 * The built-in `exec` handler: run a child process, keep the tails, honour a
 * timeout, and die properly when cancelled (SIGTERM, then SIGKILL after the
 * configured grace). A non-zero exit throws, so the queue's retry ladder and
 * dead-letter rules apply to it like any other failure.
 */
export function createExecHandler(config: Config): Handler {
  return {
    type: "exec",
    handle(payload: Record<string, unknown>, ctx: HandlerContext): Promise<void> {
      const parsed = ExecPayloadSchema.parse(payload);

      return new Promise<void>((resolve, reject) => {
        const child = spawn(parsed.command, parsed.args, {
          cwd: parsed.cwd,
          env: buildEnv(parsed),
          stdio: ["ignore", "pipe", "pipe"],
        });

        const stdout = createTail(parsed.stdoutMaxBytes);
        const stderr = createTail(parsed.stderrMaxBytes);
        child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

        let ending: "timeout" | "cancel" | null = null;
        let sent: KillSignal = "NONE";
        let graceTimer: NodeJS.Timeout | null = null;
        let timeoutTimer: NodeJS.Timeout | null = null;
        let settled = false;

        // SIGTERM first, SIGKILL once the grace window closes. Which one
        // actually ended the child is read off the exit event below.
        const endChild = (why: "timeout" | "cancel"): void => {
          if (ending || settled) return;
          ending = why;
          sent = "SIGTERM";
          child.kill("SIGTERM");
          graceTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              sent = "SIGKILL";
              child.kill("SIGKILL");
            }
          }, config.killGraceMs);
          graceTimer.unref?.();
        };

        const onAbort = (): void => endChild("cancel");
        ctx.signal.addEventListener("abort", onAbort, { once: true });

        if (parsed.timeoutMs !== undefined) {
          timeoutTimer = setTimeout(() => endChild("timeout"), parsed.timeoutMs);
          timeoutTimer.unref?.();
        }

        const cleanup = (): void => {
          settled = true;
          if (graceTimer) clearTimeout(graceTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
          ctx.signal.removeEventListener("abort", onAbort);
        };

        child.on("error", (err: Error) => {
          if (settled) return;
          cleanup();
          reject(
            new ExecFailedError(
              `failed to spawn "${parsed.command}": ${err.message}`,
              null,
              null,
              false,
            ),
          );
        });

        child.on("exit", (code: number | null, termSignal: NodeJS.Signals | null) => {
          if (settled) return;
          cleanup();
          ctx.output(stdout.text(), stderr.text());

          const killedBy: KillSignal =
            termSignal === "SIGKILL" || termSignal === "SIGTERM" ? termSignal : sent;

          if (ending === "cancel") {
            reject(new JobCancelledError(killedBy));
            return;
          }
          if (ending === "timeout") {
            reject(
              new ExecFailedError(
                `exec timed out after ${String(parsed.timeoutMs)}ms, killed by ${killedBy}${summarize(stderr.text())}`,
                code,
                termSignal,
                true,
              ),
            );
            return;
          }
          if (termSignal !== null) {
            reject(
              new ExecFailedError(
                `exec killed by ${termSignal}${summarize(stderr.text())}`,
                code,
                termSignal,
                false,
              ),
            );
            return;
          }
          if (code !== 0) {
            reject(
              new ExecFailedError(
                `exec exited with code ${String(code)}${summarize(stderr.text())}`,
                code,
                null,
                false,
              ),
            );
            return;
          }
          resolve();
        });

        if (ctx.signal.aborted) endChild("cancel");
      });
    },
  };
}
