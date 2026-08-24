# worklane — v1 spec

A single-box durable job queue with real workers, real cancel, and a live
dashboard: enqueue work, run it in the background under leases, retry it with
backoff, dead-letter what keeps failing, watch all of it happen. SQLite is the
whole persistence story. Built end-to-end by an autonomous local-model coding
loop; the commit history is part of the deliverable (see `docs/PROCESS.md`).

## v1 features (all of these, nothing more)

1. **Durable queue on SQLite (WAL).** Enqueue jobs with type, JSON payload,
   priority (int), optional dedupe key (same key + pending = rejected as
   duplicate). Jobs survive process restarts; no external broker.
2. **Worker claim loop.** N in-process workers claim jobs under a lease
   (visibility timeout + heartbeat); a worker that dies mid-job returns the
   job to the queue when its lease lapses. At-least-once delivery, documented
   as such.
3. **Command execution.** A job type maps to a registered handler; the
   built-in `exec` handler runs a child process with captured stdout/stderr
   tails, a timeout, and an env allowlist. Handlers are the extension point.
4. **Retries + dead letter.** Exponential backoff with jitter, max attempts,
   then a dead-letter state preserving the full failure trail. DLQ jobs can
   be requeued by verb.
5. **Real cancel.** Cancelling a PENDING job flips it; cancelling a RUNNING
   `exec` job SIGTERMs the child, escalates to SIGKILL after a grace window,
   and records which signal did it. Proven by integration test against a
   child that ignores SIGTERM.
6. **Chains.** A job may name a parent; it becomes claimable only when the
   parent succeeds, is cancelled with it, and dead-letters if the parent
   dead-letters. One level of fan-out — no DAGs.
7. **Ops surface.** Fastify HTTP: enqueue/inspect/cancel/requeue verbs,
   `/healthz`, `/metrics` (Prometheus text), `/events` (SSE job
   transitions), a JSONL ledger, static bearer auth. A running handler can
   report progress `{done, total, note}` and the API serves it live.
8. **The dashboard.** `GET /` — one self-contained HTML page (inline CSS/JS,
   dark ops aesthetic, light-mode aware; no CDN, no web fonts, no framework,
   no build step): queue depth by state, per-type throughput, running jobs
   with live progress bars, dead-letter queue with requeue buttons, worker
   lease table. This page is the README's hero screenshot.
9. **Deploy-grade packaging.** YAML config; systemd example; README with a
   5-minute quickstart (enqueue demo jobs, watch progress, cancel a running
   job and see the child die by signal); GitHub Actions CI — no network, no
   GPU, real short-lived child processes in tests.

## Non-goals (v1 refuses these)

- No distributed/multi-node anything. One box, one SQLite file, N workers in
  one process. The lease design leaves multi-process open; v1 does not ship it.
- No cron/schedules beyond a simple `runAfter` timestamp.
- No DAGs — parent/child only.
- No Redis, no Postgres, no message broker.
- No multi-tenant auth, no quotas. One static bearer token.
- No UI framework, no build step for the dashboard — one hand-written HTML
  file served by Fastify. React/Vite anywhere in this repo is a spec bug.

## Stack & shape

- TypeScript, Fastify, Zod, Vitest, **better-sqlite3** (the one blessed
  native dependency), pnpm. Dependency surface otherwise tiny — a task that
  adds a dependency must name it and why.
- Layout: `src/` (queue, workers, handlers, routes, dashboard), `test/`
  (unit + integration with real child processes under `test/fixtures/`),
  `deploy/`, `README.md`, `docs/PROCESS.md`.
- `docs/PROCESS.md` — how this repo was built: the autonomous-loop
  architecture, a sanitized ledger excerpt, AND the planning-tier experiment
  this repo carries (its planning lane ran a zero-cost hosted model while a
  sibling project's ran a frontier model; the executor commit-rate comparison
  gets reported honestly, whichever way it lands).

## Gates

- `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh` green at
  every phase end. Integration tests use real child processes (sleep / fail /
  ignore-SIGTERM fixtures) — deterministic, CI-safe.
- `verify.sh` = typecheck + test + scrub-check + README-quickstart lint.
- Never commit a database file, a ledger, or job output.

## Done means

A stranger follows the README: demo jobs queued in 5 minutes; progress bars
move; a cancel kills a real process by signal with the kill recorded; a
dead-lettered job comes back with one verb; the dashboard shows the queue
breathing. CI green. PROCESS.md tells both stories — the loop, and what free
planning did or didn't cost.
