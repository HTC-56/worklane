import { describe, expect, it } from "vitest";
import { createExecHandler } from "../../src/handlers/exec.js";
import { ExecFailedError, JobCancelledError } from "../../src/errors.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixture, scratchDir, sleep, testConfig, testContext, waitFor } from "../helpers.js";

const config = testConfig();
const handler = createExecHandler(config);

describe("exec handler", () => {
  it("runs a command and captures its stdout tail", async () => {
    const { ctx, captured } = testContext();
    await handler.handle({ command: "echo", args: ["hello"] }, ctx);
    expect(captured.stdout).toBe("hello\n");
    expect(captured.stderr).toBe("");
  });

  it("throws with the exit code and stderr tail when the child fails", async () => {
    const { ctx, captured } = testContext();
    const run = handler.handle(
      { command: process.execPath, args: [fixture("fail.js"), "3"] },
      ctx,
    );
    await expect(run).rejects.toBeInstanceOf(ExecFailedError);
    await expect(run).rejects.toThrow("exited with code 3");
    await expect(run).rejects.toThrow("failing on purpose");
    expect(captured.stderr).toContain("boom");
  });

  it("rejects when the command does not exist", async () => {
    const { ctx } = testContext();
    await expect(
      handler.handle({ command: "worklane_no_such_command_xyz" }, ctx),
    ).rejects.toThrow("failed to spawn");
  });

  it("passes only allowlisted variables to the child", async () => {
    process.env.WORKLANE_SECRET_TEST = "should-not-leak";
    const { ctx, captured } = testContext();
    await handler.handle(
      {
        command: process.execPath,
        args: [fixture("print-env.js")],
        env: { WORKLANE_EXPLICIT: "yes" },
        envAllowlist: ["PATH"],
      },
      ctx,
    );
    const childEnv = JSON.parse(captured.stdout) as Record<string, string>;
    expect(childEnv.WORKLANE_EXPLICIT).toBe("yes");
    expect(childEnv.PATH).toBeDefined();
    expect(childEnv.WORKLANE_SECRET_TEST).toBeUndefined();
    delete process.env.WORKLANE_SECRET_TEST;
  });

  it("keeps only the tail once output passes stdoutMaxBytes", async () => {
    const { ctx, captured } = testContext();
    await handler.handle(
      {
        command: process.execPath,
        args: [fixture("spam.js"), "50"],
        stdoutMaxBytes: 256,
      },
      ctx,
    );
    expect(Buffer.byteLength(captured.stdout, "utf8")).toBe(256);
    expect(captured.stdout.endsWith("x\n")).toBe(true);
  });

  it("times out a slow child and reports the signal that killed it", async () => {
    const { ctx } = testContext();
    const run = handler.handle(
      { command: process.execPath, args: [fixture("sleep.js"), "5000"], timeoutMs: 50 },
      ctx,
    );
    await expect(run).rejects.toBeInstanceOf(ExecFailedError);
    await expect(run).rejects.toThrow(/timed out after 50ms, killed by SIG(TERM|KILL)/);
  });

  it("escalates to SIGKILL when the child ignores SIGTERM on cancel", async () => {
    const scratch = scratchDir();
    const readyPath = join(scratch.path, "ready");
    const { ctx, controller } = testContext();
    const run = handler.handle(
      { command: process.execPath, args: [fixture("ignore-sigterm.js"), readyPath] },
      ctx,
    );
    await waitFor(() => existsSync(readyPath), "the child to ignore SIGTERM");
    controller.abort();
    const error = await run.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(JobCancelledError);
    expect((error as JobCancelledError).killSignal).toBe("SIGKILL");
    scratch.cleanup();
  });

  it("reports SIGTERM when the child dies on the first signal", async () => {
    const { ctx, controller } = testContext();
    const run = handler.handle(
      { command: process.execPath, args: [fixture("sleep.js"), "5000"] },
      ctx,
    );
    await sleep(150);
    controller.abort();
    const error = await run.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(JobCancelledError);
    expect((error as JobCancelledError).killSignal).toBe("SIGTERM");
  });
});
