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
| 8 | Dashboard | SHIPPED | D | proven by `test/dashboard/page.test.ts`, `test/dashboard/self-contained.test.ts`, `test/dashboard/progress.test.ts`, `test/dashboard/dead-letter.test.ts`, `test/dashboard/workers.test.ts` |
| 9 | Deploy-grade packaging (config, unit, README, CI) | SHIPPED | E | YAML config loader, systemd unit, README quickstart, CI workflow |
| — | docs/PROCESS.md (loop story + planning-tier experiment) | SHIPPED | E | the loop, the ledger split, and the planning-tier null result |

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
- **`/healthz` is unauthenticated**, and from Phase D so is `GET /` — every
  other route is 401 without the bearer token when one is configured. The
  dashboard shell carries no queue data and a browser cannot set a header on a
  top-level navigation, so gating the page would make it unreachable exactly
  when a token is set. Home: `TASK_PHASE_C.md` §C0, refined by
  `TASK_PHASE_D.md` §D0.
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
- **The YAML config is a documented flat-map subset, not a parser dependency** —
  one `key: value` scalar per line; indentation, sequences, inline collections,
  anchors and block scalars each raise a `ConfigError` naming the line, and an
  unknown key is rejected rather than ignored. Home: `TASK_PHASE_E.md` §E0.
- **Config precedence is `--config <path>` > `WORKLANE_CONFIG` > built-in
  defaults**, and an unrecognised argument is an error, not something ignored.
  Home: `TASK_PHASE_E.md` §E0.
- **`pnpm build` copies the dashboard HTML into `dist/dashboard/`** so a built
  tree is self-sufficient. A file copy is not a build step for the page — it is
  still hand-written and served byte-for-byte. Home: `TASK_PHASE_E.md` §E0.
- **The shipped example config carries no bearer token** — an example token in a
  public repo is worse than none. Home: `TASK_PHASE_E.md` §E0.
- **Phase E's config loader and `docs/PROCESS.md` were carried by the planning
  lane**; E1–E6 are the executor's. Home: `TASK_PHASE_E.md` §E0.
