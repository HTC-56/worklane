# Phase B — prove the queue

Phase A built the queue, the workers, the exec handler and real cancel, and
gated them with 19 tests. Phase B closes the gaps those tests do not cover and
finishes chains, which is the last v1 feature below the HTTP layer.

Everything here works against `Queue` directly — no HTTP, no dashboard. Each
task is one new file (or one focused edit plus one new file), and every one of
them ends with the same gate.

**The gate for every task in this phase:**
`pnpm typecheck` clean, `pnpm test` green, `bash scripts/scrub-check.sh` clean.

**Things that are true everywhere in this phase — do not go looking them up:**

- Test helpers live in `test/helpers.ts`: `testConfig(overrides)`,
  `testQueue(config)` (returns `{ db, queue, runningJobs }` on an in-memory
  database), `testContext()`, `fixture(name)`, `waitFor(fn, message)`, `sleep(ms)`,
  `scratchDir()`. Import them, do not re-invent them.
- Source imports inside `src/` carry a `.js` extension (`../types.js`) because
  the project is Node ESM. Test files do the same — copy the import block from
  the pattern file your task names.
- Job states: `PENDING`, `CLAIMED`, `RUNNING`, `FAILED`, `SUCCEEDED`,
  `DEAD_LETTER`, `CANCELLED`. `FAILED` means "this attempt failed, a retry is
  scheduled" — a `FAILED` job is claimable again once its `runAfter` has passed.
  `DEAD_LETTER` means attempts are exhausted.
- Always `db.close()` in an `afterEach`.

---

## §B1 — Enqueue, dedupe and parent validation

**File to create:** `test/db/queue.test.ts`
**Pattern file:** `test/workers/worker.test.ts` (its imports, `beforeEach`/`afterEach`
shape and use of `testQueue`).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

Cover `Queue.enqueue`, `Queue.getById` and `Queue.claimNext` ordering. Use
`testQueue(testConfig())`; no worker is needed — call the queue methods
directly. `DuplicateJobError` and `UnknownParentError` are exported from
`src/errors.ts`.

Assertions (6):

1. A job enqueued with only `type` comes back `PENDING`, with `attempts` 0,
   `priority` 0, `maxAttempts` equal to the config's `defaultMaxAttempts`, and
   `payload` equal to `{}`.
2. Enqueuing a second job with a dedupe key that an in-flight job already holds
   throws `DuplicateJobError`, and the queue still holds exactly one job.
3. After that first job is cancelled, the same dedupe key can be enqueued
   again and succeeds — the key is only reserved while a job is in flight.
4. Enqueuing with a `parentId` that does not exist throws `UnknownParentError`.
5. `claimNext` returns the highest `priority` first, and among equal priorities
   the oldest job first. Enqueue three jobs to show both halves.
6. A job enqueued with `runAfter` set to a moment in the future is not returned
   by `claimNext`; one with `runAfter` in the past is.

---

## §B2 — Retry ladder, dead letter and requeue

**File to create:** `test/db/retry.test.ts`
**Pattern file:** `test/db/queue.test.ts` (the file §B1 creates).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

Drive the ladder by hand: `claimNext(workerId)`, then `startJob(id, workerId)`,
then `failJob(id, workerId, "message")`. Register the worker first with
`queue.registerWorker(workerId)`. Use `testConfig({ baseBackoffMs: 10 })` so
backoff windows are milliseconds.

Assertions (5):

1. Failing an attempt on a job with `maxAttempts: 3` leaves it `FAILED` with
   `attempts` 1, a `runAfter` in the future, `lastError` equal to the message,
   and one entry in `errorTrail`.
2. Failing it until attempts reach `maxAttempts` leaves it `DEAD_LETTER` with
   `finishedAt` set and one `errorTrail` entry per attempt.
3. `requeueDeadLetter` on that job returns it `PENDING` with `attempts` back to
   0 and `runAfter` cleared, and the job is claimable again.
4. `requeueDeadLetter` on a job that is not `DEAD_LETTER` returns `null` and
   changes nothing.
5. `getStats()` reports the right counts across a small mixed set — at least one
   job in each of pending, dead-letter and succeeded.

---

## §B3 — Lease lapse returns a job to the queue

**File to create:** `test/db/lease.test.ts`
**Pattern file:** `test/db/queue.test.ts` (the file §B1 creates).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

This is the proof behind the spec's at-least-once claim: a worker that dies
mid-job does not strand its job. Force it with a tiny lease —
`testConfig({ leaseDurationMs: 5 })` — then `await sleep(30)` before calling
`queue.releaseStaleLeases()`.

Assertions (4):

1. A job claimed under a lapsed lease is returned by `releaseStaleLeases()`
   (which returns how many it reclaimed) and is `PENDING` again with
   `workerId` null and `leaseUntil` null.
2. Its `attempts` count is unchanged by the reclaim — a lapsed lease is not a
   failed attempt.
3. The reclaimed job's worker row has `claimedJobId` back to null
   (`queue.getWorkers()`).
4. With a long lease (`leaseDurationMs: 5000`), `releaseStaleLeases()` returns 0
   and the claimed job stays `CLAIMED` — and a `heartbeat(workerId, jobId)` call
   pushes `leaseUntil` further out than it was. Put an `await sleep(5)` before
   the heartbeat so the clock has actually moved.

---

## §B4 — A child waits for its parent

**File to create:** `test/db/chains.test.ts`
**Pattern file:** `test/db/queue.test.ts` (the file §B1 creates).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

The rule, in one sentence: a job with a `parentId` is not claimable until that
parent is `SUCCEEDED`. `Queue.listChildren(parentId)` lists a job's children.
Drive a parent to success with `claimNext` → `startJob` → `completeJob`.

Assertions (4):

1. With a `PENDING` parent and one child, `claimNext` returns the parent and,
   on a second call, returns nothing — the child is not claimable.
2. Once the parent is `SUCCEEDED`, `claimNext` returns the child.
3. A child whose parent was cancelled is still not claimable — `claimNext`
   returns null while only that child remains.
4. `listChildren(parentId)` returns both children of a parent with two, in id
   order, and an empty array for a job with none.

---

## §B5 — Cancelling a job cancels its children

**File to edit:** `src/db/queue.ts`
**File to create:** `test/db/chains-cascade.test.ts`
**Pattern file:** `src/db/queue.ts` itself — the existing `markCancelled` method
shows the exact UPDATE shape, and `listChildren` shows how children are found.
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

The rule, in one sentence: when a job becomes `CANCELLED`, every child of that
job that has not already reached a terminal state becomes `CANCELLED` too, with
`lastError` naming the parent.

Add one private method to `Queue` that cancels the children of a given job id,
and call it from the two places a job reaches `CANCELLED`: the non-running
branch of `cancelJob`, and `markCancelled`. Terminal states — `SUCCEEDED`,
`DEAD_LETTER`, `CANCELLED` — are left alone. One level only: cancel the direct
children, do not recurse.

Assertions (4), in `test/db/chains-cascade.test.ts`:

1. Cancelling a `PENDING` parent leaves both of its children `CANCELLED`.
2. Each cancelled child's `lastError` mentions its parent's id.
3. A child that had already `SUCCEEDED` is untouched when the parent is
   cancelled — it stays `SUCCEEDED`.
4. Cancelling a job with no children still works and returns
   `wasRunning: false`.

---

## §B6 — Dead-lettering a job dead-letters its children

**File to edit:** `src/db/queue.ts`
**File to create:** `test/db/chains-dlq.test.ts`
**Pattern file:** `src/db/queue.ts` itself — the child-cancel method added in
§B5 is the shape to copy.
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

The rule, in one sentence: when a job reaches `DEAD_LETTER`, every child of that
job that has not already reached a terminal state also becomes `DEAD_LETTER`,
with the reason naming the parent. A child that dead-letters this way keeps its
own `errorTrail` and gains one entry for the parent's failure.

Add one private method beside §B5's, and call it from the two places a job
reaches `DEAD_LETTER`: the exhausted-attempts branch of `failJob`, and
`deadLetterJob`. Terminal states are left alone; one level only.

Assertions (4):

1. A parent driven to `DEAD_LETTER` by exhausting `maxAttempts: 1` leaves its
   child `DEAD_LETTER`.
2. The child's `lastError` mentions its parent's id, and its `errorTrail` has
   the new entry.
3. A parent dead-lettered by `deadLetterJob` (the no-handler path) cascades the
   same way.
4. A child that already `SUCCEEDED` is untouched.

---

## §B7 — Phase verify

**Files to edit:** `STATUS.md`, `ROADMAP.md`
**Pattern file:** `STATUS.md` — copy the shape of the "Phase A" section.
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

1. Run `bash scripts/verify.sh`. It must end with "verify: all gates green".
   If it does not, fix what it reports before doing anything else.
2. Append a `## Phase B — ...` section to `STATUS.md` saying what Phase B
   proved and how many tests the suite now has. Append only; do not rewrite
   anything above it.
3. In `ROADMAP.md`, change rows 1, 2, 4 and 6 from `PARTIAL` to `SHIPPED`, set
   their phase column to `B`, and replace each note with one short phrase
   naming the test file that proves it. Change nothing else in the table.
4. Commit `STATUS.md` and `ROADMAP.md` with a message naming task B7.
