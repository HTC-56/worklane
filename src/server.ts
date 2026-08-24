import { resolveConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import { createRuntime } from "./runtime.js";

/**
 * The entry point: read the config (`--config <path>`, else `WORKLANE_CONFIG`,
 * else the built-in defaults), start the runtime, and catch the signals that
 * should drain it rather than kill it.
 */
async function main(): Promise<void> {
  const { config, source } = resolveConfig(process.argv.slice(2), process.env);
  const runtime = createRuntime(config);
  const address = await runtime.listen();

  process.stdout.write(
    `worklane listening on ${address} — ${String(config.workerCount)} workers, ` +
      `db ${config.dbPath}, config ${source}\n`,
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
  // A bad config is the operator's typo, not a crash — print it without a stack.
  const message = err instanceof ConfigError ? err.message : String(err);
  process.stderr.write(`worklane failed to start: ${message}\n`);
  process.exit(1);
});
