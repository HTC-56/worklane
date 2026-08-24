# Phase A: Core Execution & Worker Loop

This phase ships the exec handler, the worker claim loop, and real cancel with SIGTERM→SIGKILL. The queue infrastructure (schema, types, Queue class) is already in place.

---

## §A1 — Exec Handler

**File to create:** `src/handlers/exec.ts`  
**Pattern file:** `src/db/queue.ts` (for Zod validation style, error handling)  
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

### Spec

Implement the built-in `exec` handler. It runs a child process with:

- **Input payload schema** (validated by Zod at call site):
  ```ts
  const ExecPayloadSchema = z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).optional(),        // allowlist merged with process.env
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    stdoutMaxBytes: z.number().int().positive().default(65536),
    stderrMaxBytes: z.number().int().positive().default(65536),
  });
  ```

- **Behavior:**
  1. Spawn `command` with `args` using `child_process.spawn`.
  2. Merge `env` allowlist over `process.env` (only keys in allowlist pass through).
  3. Capture stdout/stderr with rolling buffers capped at `stdoutMaxBytes` / `stderrMaxBytes` (keep tail).
  4. Enforce `timeoutMs` (default: config value, see §A3). On timeout: SIGTERM → wait `killGraceMs` → SIGKILL.
  5. Return `{ exitCode, signal, stdout, stderr, timedOut }` via a resolved promise. Never throw for non-zero exit — the *queue* decides retry/DLQ based on exit code.
  6. Expose a `cancel()` method that sends SIGTERM then SIGKILL after `killGraceMs`, mirroring the timeout path.

- **Export:** `export const execHandler: Handler` where `Handler` is the type from `types.ts` (type + handle fn).

### Tests (describe in prose — executor writes them)

Create `test/handlers/exec.test.ts` with 4–6 assertions:
1. Runs a simple command (`echo hello`) and returns exitCode 0 with stdout "hello\n".
2. Captures stderr from a failing command (`ls /nonexistent`) and returns non-zero exitCode.
3. Respects timeout: a `sleep 10` with `timeoutMs: 50` times out, kills the child, returns `timedOut: true` and `signal: "SIGKILL"`.
4. Env allowlist: only allowlisted keys reach the child; others are dropped.
5. Rolling buffers: stdout larger than `stdoutMaxBytes` keeps only the tail.
6. `cancel()` on a running child sends SIGTERM then SIGKILL after grace period.

---

## §A2 — Worker Loop

**File to create:** `src/workers/worker.ts`  
**Pattern file:** `src/db/queue.ts` (for Queue method usage, transaction style)  
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

### Spec

Implement the in-process worker that claims jobs, runs handlers, and heartbeats.

- **Worker class** with:
  - `constructor(queue: Queue, handlers: Map<string, Handler>, config: Config, workerId: string)`
  - `start(): Promise<void>` — runs the claim loop until `stop()` called
  - `stop(): Promise<void>` — signals shutdown, waits for current job to finish or be cancelled

- **Claim loop** (inside `start()`):
  1. Register worker via `queue.registerWorker(workerId)`.
  2. Loop while not stopping:
     - `queue.claimNext(workerId)` → if null, sleep 100ms (configurable later), continue.
     - `queue.startJob(jobId, workerId)` → if null (race), continue.
     - Look up handler by `job.type`; if missing, `queue.failJob(jobId, workerId, "No handler for type: ...")`, continue.
     - Call `handler.handle(job.payload)` with a **progress callback** bound to `queue.updateProgress(jobId, workerId, ...)`.
     - On handler resolution: `queue.completeJob(jobId, workerId)`.
     - On handler rejection: `queue.failJob(jobId, workerId, error.message)`.
     - Heartbeat every `config.heartbeatIntervalMs` while job runs (use `setInterval`, clear on job end).
  3. On `stop()`: set stopping flag, if a job is running call `queue.cancelJob(jobId)` (the handler's `cancel()` if exec), wait for job to settle, then `queue.unregisterWorker(workerId)`.

- **Export:** `export class Worker` and a factory `export function createWorker(...): Worker`.

### Tests (prose)

Create `test/workers/worker.test.ts` with 4–5 assertions:
1. Worker claims a PENDING job, runs handler, marks SUCCEEDED.
2. Worker heartbeats while job runs (lease extends).
3. Handler failure triggers retry logic (job goes PENDING with run_after).
4. Stop() waits for current job, then unregisters worker.
5. Missing handler type → job fails with descriptive error.

---

## §A3 — Real Cancel (SIGTERM → SIGKILL)

**Files to edit:** `src/db/queue.ts` (extend `cancelJob`), `src/handlers/exec.ts` (ensure `cancel()` matches)  
**Pattern file:** `src/db/queue.ts` (existing `cancelJob` method)  
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

### Spec

Make cancel real for RUNNING `exec` jobs. The queue already tracks `workerId` and `state`.

- **In `queue.ts` — extend `cancelJob(jobId: number)`**:
  - If job.state === "RUNNING" and job.type === "exec":
    - Need a way to signal the worker. Add a `cancelRunningJob(jobId: number, workerId: string): Promise<CancelResult>` method that:
      1. Looks up the worker's in-memory `Worker` instance (pass a `workers: Map<string, Worker>` reference to Queue, or emit an event the worker loop listens to — simpler: add a `onCancel: (jobId, workerId) => void` callback to Queue constructor).
      2. Worker receives cancel signal, calls its current handler's `cancel()`.
      3. Wait up to `config.killGraceMs` for job to transition out of RUNNING.
      4. If still RUNNING, the worker's `cancel()` already escalates to SIGKILL.
      5. Record which signal killed it in `last_error` (e.g., "cancelled by SIGTERM" or "cancelled by SIGKILL").
      6. Return `CancelResult` { jobId, signal: "SIGTERM" | "SIGKILL" | "NONE", wasRunning: true }.
  - For PENDING/CLAIMED: existing logic is fine (flip to CANCELLED).
  - For other states: return { job, wasRunning: false, signal: "NONE" }.

- **In `exec.ts` — ensure `cancel()` method**:
  - If child exists and not exited: `child.kill("SIGTERM")`, wait `killGraceMs` (passed in or from config), then `child.kill("SIGKILL")`.
  - Resolve the handler promise with `{ exitCode: null, signal: "SIGTERM" | "SIGKILL", stdout, stderr, timedOut: false }`.

- **Integration test** (prose): Create `test/integration/cancel.test.ts` using fixture `test/fixtures/ignore-sigterm.js` (a Node script that ignores SIGTERM and only exits on SIGKILL). Assert:
  1. Enqueue exec job running the fixture.
  2. Wait for state RUNNING.
  3. Call cancel API (or queue.cancelJob directly).
  4. Job ends with `signal: "SIGKILL"` recorded, state becomes FAILED or DEAD_LETTER (depending on attempts), and `last_error` contains "SIGKILL".

---

## §A4 — Scrub Check Script

**File to create:** `scripts/scrub-check.sh`  
**Pattern file:** (none — simple bash)  
**Gate:** `bash scripts/scrub-check.sh` must pass

### Spec

A fast shell script that fails if any committed file contains:
- Private hostnames (anything not `localhost` or `192.0.2.*`)
- Real LAN IPs (10.*, 172.16-31.*, 192.168.*)
- Absolute home paths (`/home/`, `/Users/`, `~`)
- Key material (`-----BEGIN`, `PRIVATE KEY`, `secret`, `token=` in non-test files)
- References to other private projects (grep for known local project names — keep list in script)

Run on staged files via `git diff --cached --name-only` or all tracked files. Exit 1 on any match with a clear message.

---

## §A5 — Verify Script

**File to create:** `scripts/verify.sh`  
**Pattern file:** `package.json` scripts  
**Gate:** `bash scripts/verify.sh` must pass

### Spec

Composes all gates:
```bash
#!/usr/bin/env bash
set -euo pipefail
pnpm typecheck
pnpm test
bash scripts/scrub-check.sh
# TODO: add README quickstart lint when README exists
echo "All gates green"
```

---

## Phase A Task Summary (for TODO.md)

- [ ] **A1** Exec handler — `src/handlers/exec.ts` + test — gate: typecheck/test/scrub
- [ ] **A2** Worker loop — `src/workers/worker.ts` + test — gate: typecheck/test/scrub
- [ ] **A3** Real cancel (SIGTERM→SIGKILL) — edit `src/db/queue.ts`, `src/handlers/exec.ts` + integration test — gate: typecheck/test/scrub
- [ ] **A4** Scrub check script — `scripts/scrub-check.sh` — gate: scrub-check
- [ ] **A5** Verify script — `scripts/verify.sh` — gate: verify
- [ ] **A6** Phase verify — run `bash scripts/verify.sh`, update ROADMAP.md rows 1–3 to SHIPPED, commit
---

## §A0 — Phase A closing note (appended by the planning lane, 2026-08-24)

**Phase A shipped as planning-lane commits, not executor tasks.** The sections
above were drafted alongside a partial implementation that was left uncommitted
and did not typecheck. Under the implement-or-delegate rule, code the planning
lane has already written is planning-lane work: it was finished, gated and
committed here rather than serialised into a spec for the executor to re-type.
The task summary above is therefore **superseded** — no `- [ ]` line from this
document ever entered TODO.md. The executor's first phase is Phase B
(`TASK_PHASE_B.md`).

Shipped in commits `2f45a18`…`372fd8d`: toolchain, SQLite queue, worker claim
loop, cancel registry, exec handler, 19 tests, scrub and verify gates.

### Calls made while implementing, recorded here as reservations

1. **`FAILED` means "attempt failed, retry scheduled".** A job with attempts
   left goes to `FAILED` with `run_after` set and is claimable again once that
   time passes; `DEAD_LETTER` is for exhausted attempts. This keeps every state
   in the spec's list meaningful and makes retries visible to `/metrics` later.
   Claimable states are `PENDING` and `FAILED`.
2. **A dedupe key is reserved only while its job is in flight.** A partial
   unique index covers `PENDING/CLAIMED/RUNNING/FAILED` only, so the same key is
   reusable once the previous job reaches a terminal state. SPEC.md says "same
   key + pending = rejected", not "key burned forever".
3. **Captured output tails live on the job** (`jobs.stdout_tail`,
   `jobs.stderr_tail`), written through `HandlerContext.output`. SPEC.md
   feature 3 requires capturing them and the ops surface needs somewhere to
   read them from. Nothing is ever written to disk outside the database.
4. **Worker shutdown releases the in-flight job back to `PENDING`** with its
   attempt count untouched. Stopping a worker is not a failed attempt; cancel
   is the verb that ends a job.
5. **`Handler` is a plain TypeScript interface, not a Zod schema.** The
   original `z.function()` shape inferred so loosely that real type errors went
   unreported. Zod still validates everything that crosses a boundary
   (`EnqueueInput`, `Config`, `ExecPayload`, `ProgressUpdate`).
6. **`exactOptionalPropertyTypes` is off; `strict` and
   `noUncheckedIndexedAccess` stay on.** That flag's diagnostics are hard to act
   on and would spend executor sessions on type puzzles rather than on the spec.
