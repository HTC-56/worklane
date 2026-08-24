import { createRuntime } from "./runtime.js";
import { defaultConfig } from "./types.js";

/**
 * The entry point. v1 starts from the built-in defaults; the YAML config file
 * of SPEC feature 9 lands here, replacing `defaultConfig()` with a loader.
 */
async function main(): Promise<void> {
  const config = defaultConfig();
  const runtime = createRuntime(config);
  const address = await runtime.listen();

  process.stdout.write(
    `worklane listening on ${address} — ${String(config.workerCount)} workers, db ${config.dbPath}\n`,
  );
  if (config.bearerToken === undefined) {
    process.stdout.write(
      "warning: no bearerToken configured — the API is unauthenticated, keep the bind loopback-only\n",
    );
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\n${signal} received — draining workers\n`);
    runtime.stop().then(
      () => process.exit(0),
      (err: unknown) => {
        process.stderr.write(`shutdown failed: ${String(err)}\n`);
        process.exit(1);
      },
    );
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  process.stderr.write(`worklane failed to start: ${String(err)}\n`);
  process.exit(1);
});
