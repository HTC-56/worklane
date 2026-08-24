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
