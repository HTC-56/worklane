# Roadmap — the v1 scoreboard

One row per SPEC.md feature. The planning lane keeps status current; row edits
here are the one permitted exception to append-only docs.

| # | Feature (SPEC.md) | Status | Phase | Note |
|---|---|---|---|---|
| 1 | Durable queue on SQLite (WAL) | SHIPPED | B | proven by `test/db/queue.test.ts` |
| 2 | Worker claim loop (lease/heartbeat) | SHIPPED | B | proven by `test/db/lease.test.ts` |
| 3 | Command execution (exec handler) | SHIPPED | A | env allowlist, output tails, timeout; 8 tests |
| 4 | Retries + dead letter | SHIPPED | B | proven by `test/db/retry.test.ts` |
| 5 | Real cancel (SIGTERM→SIGKILL, recorded) | SHIPPED | A | proven against a child that ignores SIGTERM; signal recorded on the job |
| 6 | Chains (parent/child) | SHIPPED | B | proven by `test/db/chains.test.ts` |
| 7 | Ops surface (verbs, healthz, metrics, SSE, ledger, auth, progress) | SHIPPED | C | proven by `test/http/verbs.test.ts`, `test/http/auth.test.ts`, `test/http/cancel-requeue.test.ts`, `test/http/ops.test.ts`, `test/http/events.test.ts`, `test/handlers/demo.test.ts` |
| 8 | Dashboard | NOT BUILT | — | |
| 9 | Deploy-grade packaging (config, unit, README, CI) | PARTIAL | A | scrub-check + verify gates exist; config/unit/README/CI outstanding |
| — | docs/PROCESS.md (loop story + planning-tier experiment) | NOT BUILT | — | written near the end |

When every row reads SHIPPED and verify.sh is green, the project is done — the
planning lane declares PROJECT SPEC COMPLETE rather than inventing scope.

## Reservations ledger — small deferred calls recorded inside phase specs

- **State `FAILED` = retry scheduled** (claimable once `run_after` passes);
  `DEAD_LETTER` = attempts exhausted. Home: `TASK_PHASE_A.md` §A0.
- **Dedupe keys are reserved only while a job is in flight** — partial unique
  index, key reusable after a terminal state. Home: `TASK_PHASE_A.md` §A0.
- **Output tails live on the job row** (`stdout_tail`/`stderr_tail`) so the ops
  surface has somewhere to read them. Home: `TASK_PHASE_A.md` §A0.
- **Worker shutdown releases the in-flight job to `PENDING`**, attempts
  untouched. Home: `TASK_PHASE_A.md` §A0.
- **`exactOptionalPropertyTypes` off, `strict` on** so gate failures are ones
  the executor can act on. Home: `TASK_PHASE_A.md` §A0.
- **Phase A was carried by the planning lane, not the executor** — the code was
  already written when the phase was planned. Home: `TASK_PHASE_A.md` §A0.
- **`/healthz` is the only unauthenticated route** — every other route is 401
  without the bearer token when one is configured. Home: `TASK_PHASE_C.md` §C0.
- **`/events` authenticates by header**, so the dashboard must read the stream
  with `fetch`, not `EventSource`. Home: `TASK_PHASE_C.md` §C0.
- **`GET /jobs/:id` answers `{ job, children }`** — chain inspection needs no
  verb of its own. Home: `TASK_PHASE_C.md` §C0.
- **Ledger appends are synchronous**; a failed append increments
  `writeFailures` and is never thrown at a running job. Home:
  `TASK_PHASE_C.md` §C0.
- **`httpPort: 0` means "any free port"** — how the HTTP tests bind. Home:
  `TASK_PHASE_C.md` §C0.
- **Phase C's HTTP layer was carried by the planning lane** — six interlocking
  files do not fit one local session; C1–C6 are the executor's.
  Home: `TASK_PHASE_C.md` §C0.
