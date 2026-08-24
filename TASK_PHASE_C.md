# Phase C — the ops surface, proven

Phase A built the queue, workers, exec and real cancel. Phase B proved them.
Phase C is SPEC feature 7: the Fastify HTTP surface. **The code is already
written and committed** (see §C0); the tasks below prove it, and add the one
piece the quickstart still needs — a demo handler that reports progress.

**The gate for every task in this phase:**
`pnpm typecheck` clean, `pnpm test` green, `bash scripts/scrub-check.sh` clean.

**Things that are true everywhere in this phase — do not go looking them up:**

- `testApp(overrides)` in `test/helpers.ts` returns
  `{ app, queue, bus, ledger, db, runningJobs, config, auth, close }` over an
  in-memory database with **no workers running**. Drive the HTTP surface with
  `await t.app.inject({ method, url, headers: t.auth, payload })`. `close()` is
  async — `await t.close()` in `afterEach`.
- `t.auth` is the bearer header object, empty unless the config sets
  `bearerToken`. `r.json()` parses an inject reply; `r.statusCode` is its status.
- Other helpers already exist: `listenTestApp(t)` (binds to a loopback port,
  returns the base URL), `readSseEvents(url, opts)`, `readLedger(path)`,
  `scratchDir()`, `waitFor()`, `sleep()`. Import them; do not re-invent them.
- Imports carry a `.js` extension (`../../src/types.js`) — this is Node ESM.
- Job states: `PENDING`, `CLAIMED`, `RUNNING`, `FAILED`, `SUCCEEDED`,
  `DEAD_LETTER`, `CANCELLED`.
- To reach `DEAD_LETTER` without a worker: `queue.registerWorker("w1")`,
  `queue.claimNext("w1")`, `queue.startJob(id, "w1")`,
  `queue.failJob(id, "w1", "boom")` on a job enqueued with `maxAttempts: 1`.

---

## §C0 — What the planning lane already built (read once, do not rebuild)

Committed as `feat(C0a)`…`feat(C0d)`, gated green. Nothing in this section is a
task.

- `src/events.ts` — `JobEvent { ts, kind, jobId, type, state, attempts, error,
  progress }` and `EventBus` (fan-out + ring buffer + `recent(n)`).
  `kind` is one of `enqueued, claimed, started, progress, succeeded, failed,
  dead_letter, cancelled, requeued, released`.
- `src/ledger.ts` — `Ledger`, one JSON object per line appended synchronously.
- `src/app.ts` — `createApp()`: bearer auth, error mapping, route registration.
- `src/routes/jobs.ts` — `POST /jobs`, `GET /jobs`, `GET /jobs/:id`,
  `POST /jobs/:id/cancel`, `POST /jobs/:id/requeue`.
- `src/routes/ops.ts` — `GET /healthz`, `/stats`, `/metrics`, `/events`.
- `src/runtime.ts`, `src/server.ts` — process wiring and the entrypoint.
- `Queue.setEventSink()`, `Queue.byType()`, `Queue.database`.

**Reservations recorded here:**

- `/healthz` is the only route that answers without a bearer token — a health
  check that needs a credential is not a health check. Everything else is 401
  when `config.bearerToken` is set, and open when it is not.
- The bearer token is compared with `crypto.timingSafeEqual`, length first.
- `GET /jobs/:id` answers `{ job, children }` — chain inspection needs no
  separate verb.
- `/events` authenticates with an `Authorization` header, so the dashboard must
  read it with `fetch`, not `EventSource`. `?replay=N` re-sends the last N.
- Ledger appends are synchronous; a failed append increments
  `ledger.writeFailures` and is never thrown at a running job.
- `httpPort: 0` means "any free port", which is how tests bind.
- Phase C's HTTP layer was carried by the planning lane, not the executor: it
  is six interlocking files, which does not fit one local session.

---

## §C1 — Enqueue and inspect over HTTP

**File to create:** `test/http/verbs.test.ts`
**Pattern file:** `test/db/queue.test.ts` (its `beforeEach`/`afterEach` shape).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

Use `testApp()` with no overrides, so no token is needed. Every request goes
through `t.app.inject`.

Assertions (6):

1. `POST /jobs` with `{ type: "exec", payload: { command: "true" }, priority: 5 }`
   answers 201, and the body's `job` has an `id`, state `PENDING` and priority 5.
2. `GET /jobs/:id` for that id answers 200 with `job.id` equal to it and a
   `children` array that is empty.
3. `GET /jobs/:id` for an id that does not exist answers 404 with an `error`
   string.
4. `POST /jobs` twice with the same `dedupeKey` answers 201 then 409, and the
   409 body carries `existingJobId`.
5. `POST /jobs` with `{ type: "exec", parentId: 4242 }` answers 400; so does a
   body with no `type` at all.
6. `GET /jobs?state=PENDING` answers 200 with a `jobs` array holding only
   `PENDING` jobs, plus a `stats` object whose `pending` count matches its length.

---

## §C2 — The bearer token

**File to create:** `test/http/auth.test.ts`
**Pattern file:** `test/http/verbs.test.ts` (the file §C1 creates).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

Build the app with `testApp({ bearerToken: "0123456789abcdef0123" })`. The rule,
in one sentence: with a token configured, every route except `/healthz` answers
401 unless the request carries `Authorization: Bearer <that exact token>`.

Assertions (4):

1. `GET /jobs` with no `Authorization` header answers 401.
2. The same request with `t.auth` answers 200.
3. `GET /jobs` with `Authorization: Bearer wrong-token-here-xx` answers 401, and
   so does a header that is not in `Bearer …` form at all.
4. `GET /healthz` answers 200 with **no** header — and on a second app built
   with `testApp()` (no token at all), `GET /jobs` answers 200 unauthenticated.

---

## §C3 — Cancel and requeue over HTTP

**File to create:** `test/http/cancel-requeue.test.ts`
**Pattern file:** `test/http/verbs.test.ts` (the file §C1 creates).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

No worker runs in `testApp`, so drive states through `t.queue` directly (see the
recipe in the phase preamble) and check them back over HTTP.

Assertions (4):

1. `POST /jobs/:id/cancel` on a `PENDING` job answers 200; the body's `result`
   has `wasRunning: false` and `signal: "NONE"`, and the returned `job` is
   `CANCELLED`.
2. `POST /jobs/:id/cancel` on an id that does not exist answers 404.
3. `POST /jobs/:id/requeue` on a job driven to `DEAD_LETTER` answers 200 and the
   returned job is `PENDING` with `attempts` back to 0.
4. `POST /jobs/:id/requeue` on a job that is not `DEAD_LETTER` answers 409 and
   the job's state is unchanged; on an unknown id it answers 404.

---

## §C4 — healthz, stats and Prometheus metrics

**File to create:** `test/http/ops.test.ts`
**Pattern file:** `test/http/verbs.test.ts` (the file §C1 creates).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

Enqueue a small mixed set first — a couple of `exec` jobs and one of another
type, at least one of them cancelled — so the counts are not all zero.

Assertions (5):

1. `GET /healthz` answers 200 with `ok: true`, a numeric `uptimeMs`, a
   `schemaVersion` of 1, and a `stats` object.
2. `GET /metrics` answers 200 with a content type containing `text/plain`.
3. The metrics body contains a `# TYPE worklane_jobs gauge` line and a
   `worklane_jobs{state="pending"}` line whose number equals the queue's pending
   count.
4. The metrics body contains a `worklane_jobs_by_type{type="exec",…}` line for
   the `exec` type, and a `worklane_workers` line.
5. `GET /stats` answers 200 with `stats`, a `byType` array containing an entry
   whose `type` is `"exec"`, a `workers` array, and a numeric
   `throughputWindowMs`.

---

## §C5 — The SSE stream and the JSONL ledger

**File to create:** `test/http/events.test.ts`
**Pattern file:** `test/http/verbs.test.ts` (the file §C1 creates).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

`/events` needs a real socket, so this file uses `listenTestApp(t)` to get a base
URL and `readSseEvents(url, opts)` to read it. `readSseEvents` resolves once
`count` events have arrived and returns `{ kind, data }[]`; do the work that
produces the events inside its `onOpen` callback, or they happen before anyone is
listening. Give it `timeoutMs: 5000`.

For the ledger, build the app with `testApp({ ledgerPath: join(dir, "ledger.jsonl") })`
using a `scratchDir()` path, and read it back with `readLedger(path)`. Clean the
scratch directory up in `afterEach`.

Assertions (4):

1. Against `${url}/events?replay=0`, enqueuing two jobs inside `onOpen` yields
   two events, both of kind `enqueued`, carrying those job ids.
2. Driving one job to `CANCELLED` inside `onOpen` yields an event of kind
   `cancelled` whose `data.state` is `CANCELLED`.
3. Against `${url}/events?replay=5` on a bus that already saw events, the events
   arrive without any new work being done — replay re-sends history.
4. With a `ledgerPath` configured, enqueuing a job then cancelling it leaves a
   file whose parsed lines include one `enqueued` and one `cancelled` entry, each
   with a numeric `ts` and the right `jobId`.

---

## §C6 — A demo handler that reports progress

**File to create:** `src/handlers/demo.ts`
**File to edit:** `src/runtime.ts` — one line: the array in
`for (const handler of [createExecHandler(config), ...extraHandlers])`.
**File to create:** `test/handlers/demo.test.ts`
**Pattern file:** `src/handlers/exec.ts` — copy its Zod payload schema style, its
`Handler` shape (`{ type, handle(payload, ctx) }`) and how it reads `ctx.signal`.
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

The README quickstart promises "enqueue demo jobs, watch progress" (SPEC feature
9), and nothing in the repo currently calls `ctx.progress`. Add a `demo` handler:
it does no real work, it just walks a number of steps and reports each one.

- Payload schema: `steps` (positive int, default 10) and `stepMs` (positive int,
  default 200).
- `handle` loops from 1 to `steps`. Each pass, in this order: if
  `ctx.signal.aborted` is true throw `new JobCancelledError("NONE")` (exported
  from `../errors.js`); otherwise wait `stepMs`, then call `ctx.progress` with
  `done` = the pass number, `total` = `steps`, and a `note` naming the step.
- Checking once per pass is enough — cancel lands within one step, and the demo
  handler runs no child process, so there is no signal to escalate.
- Export `createDemoHandler(): Handler`, then register it in `src/runtime.ts`
  alongside `createExecHandler(config)`.

Assertions (4), in `test/handlers/demo.test.ts` — use `testContext()` from
`test/helpers.ts` and `stepMs: 5` so the test is fast:

1. `handle({ steps: 3, stepMs: 5 }, ctx)` resolves, and `captured.progress` holds
   three updates.
2. The last update is `{ done: 3, total: 3 }` and its `note` mentions step 3.
3. Aborting the controller before calling `handle` makes it reject with a
   `JobCancelledError`.
4. The handler's `type` is `"demo"`, and a payload with no fields at all is
   accepted (the defaults apply) — assert the schema defaults by calling
   `handle({}, ctx)` with a controller you abort immediately, and expect a
   `JobCancelledError` rather than a validation error.

---

## §C7 — Phase verify

**Files to edit:** `STATUS.md`, `ROADMAP.md`
**Pattern file:** `STATUS.md` — copy the shape of the "Phase B" section.
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

1. Run `bash scripts/verify.sh`. It must end with "verify: all gates green".
   If it does not, fix what it reports before doing anything else.
2. Append a `## Phase C — the ops surface, proven` section to `STATUS.md`:
   what the HTTP surface does, which test files prove it, how many tests the
   suite now has, and the fact that §C0's code came from the planning lane while
   C1–C6 were the executor's. Append only; do not rewrite anything above it.
3. In `ROADMAP.md`, change row 7 from `PARTIAL` to `SHIPPED`, leave its phase
   column as `C`, and replace its note with one short phrase naming the
   `test/http/` files that prove it. Change nothing else in the table.
4. Commit `STATUS.md` and `ROADMAP.md` with a message naming task C7.
