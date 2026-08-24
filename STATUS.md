# Status

Repo scaffolded 2026-08-24. Nothing built yet. SPEC.md is the product;
DECISIONS.md locks the fence; ROADMAP.md is the scoreboard. The planning lane
authors Phase A from SPEC.md.

Per-phase sections append below as phases ship.

## Phase A — core queue, workers, exec, real cancel (2026-08-24)

Shipped by the planning lane (commits `2f45a18`…`372fd8d`), not by the
executor: the code already existed in the working tree, unfinished and
un-gated, when the phase was planned, so re-specifying it would have been
transcription rather than delegation. See `TASK_PHASE_A.md` §A0.

Built: WAL schema and migration hook; `Queue` (enqueue with priority, dedupe,
`runAfter`, parent; claim under lease; heartbeat; complete; retry with
exponential backoff and jitter; dead letter with the full error trail; requeue;
stale-lease recovery; progress; output tails); `RunningJobs` cancel registry;
`Worker` claim loop; the `exec` handler (env allowlist, output tails, timeout,
SIGTERM→SIGKILL escalation); `scripts/scrub-check.sh` and `scripts/verify.sh`.

Gates: `pnpm typecheck` clean, 19 tests green over real child processes,
`scrub-check` clean. The headline proof is in `test/integration/cancel.test.ts` —
a child that installs a no-op SIGTERM handler is escalated to SIGKILL and the
job records `cancelled by SIGKILL`.

Not yet proven by tests, and therefore left PARTIAL on the scoreboard: enqueue
dedupe rejection, lease-lapse recovery, dead-letter exhaustion and requeue,
chain claim gating. Those are Phase B, which is the executor's first phase.

## Phase B — prove the queue (2026-08-24)

Proved: dead-letter cascade to direct children, parent/child claim gating, lease
lapse recovery, retry ladder with exponential backoff and jitter, dedupe on
enqueue. Six test files, 27 assertions, all over real child processes where
applicable.

- `test/db/queue.test.ts` (6) — enqueue with priority, dedupe, parent validation.
- `test/db/retry.test.ts` (5) — retry ladder, dead letter, requeue.
- `test/db/lease.test.ts` (4) — stale lease returns job to queue.
- `test/db/chains.test.ts` (4) — child waits for parent.
- `test/db/chains-cascade.test.ts` (4) — cancel cascades to direct children.
- `test/db/chains-dlq.test.ts` (4) — dead-letter cascades to direct children.

Gates: `pnpm typecheck` clean, 46 tests green, `scrub-check` clean.

## Phase C — the ops surface, proven (2026-08-24)

Proved: the HTTP surface — enqueue/inspect verbs, bearer token auth, cancel and
requeue, healthz/stats/Prometheus metrics, SSE event stream with JSONL ledger,
and a demo progress-reporting handler. Six test files, 27 assertions.

- `test/http/verbs.test.ts` (6) — enqueue and inspect jobs over HTTP.
- `test/http/auth.test.ts` (4) — bearer token authentication on every route
  except `/healthz`.
- `test/http/cancel-requeue.test.ts` (4) — cancel PENDING, cancel missing,
  requeue DEAD_LETTER, requeue non-DEAD_LETTER/missing.
- `test/http/ops.test.ts` (5) — `/healthz`, `/metrics`, `/stats`.
- `test/http/events.test.ts` (4) — SSE stream and JSONL ledger.
- `test/handlers/demo.test.ts` (4) — demo handler that reports progress.

Gates: `pnpm typecheck` clean, 73 tests green, `scrub-check` clean.

## Phase D — the dashboard, proven (2026-08-24)

Proved: the self-contained dashboard shell on `GET /`, its live progress bars,
dead-letter panel with requeue button, and the worker lease table. Five test
files, 22 assertions.

- `test/dashboard/page.test.ts` (5) — dashboard HTML shell on `GET /`.
- `test/dashboard/self-contained.test.ts` (5) — zero external requests in the
  dashboard HTML.
- `test/dashboard/progress.test.ts` (4) — live progress bars read from the
  jobs endpoint.
- `test/dashboard/dead-letter.test.ts` (4) — dead-letter panel and its
  requeue button.
- `test/dashboard/workers.test.ts` (4) — worker lease table on the dashboard.

Gates: `pnpm typecheck` clean, 93 tests green, `scrub-check` clean.

## Phase E — deploy-grade packaging (2026-08-24)

Proved: the YAML config loader, the shipped example config, the systemd unit,
the README quickstart, and the CI workflow. Five test files and one
integration gate, 104 assertions total.

- `test/config/load.test.ts` (6) — scalar parsing, file loading, error cases,
  config resolution precedence.
- `deploy/worklane.service` — systemd unit file with drain on SIGTERM.
- `README.md` — quickstart and reference matching `docs/PROCESS.md` register.
- `.github/workflows/ci.yml` — one-job CI running `bash scripts/verify.sh`.
- `test/deploy/packaging.test.ts` (5) — example config ships no token, systemd
  unit has required directives, CI has correct toolchain, README passes lint.

Gates: `pnpm typecheck` clean, 104 tests green, `scrub-check` clean. Every
ROADMAP row now reads SHIPPED.
