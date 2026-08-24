# Phase D — the dashboard, proven

Phases A–C built and proved the queue, the workers, real cancel and the HTTP
ops surface. Phase D is SPEC feature 8: `GET /`, one self-contained HTML page.
**The page is already written and committed** (see §D0); the tasks below prove
it and prove the four data paths it draws from.

**The gate for every task in this phase:**
`pnpm typecheck` clean, `pnpm test` green, `bash scripts/scrub-check.sh` clean.

**Things that are true everywhere in this phase — do not go looking them up:**

- `testApp(overrides)` in `test/helpers.ts` returns
  `{ app, queue, bus, ledger, db, runningJobs, config, auth, close }` over an
  in-memory database with **no workers running**. Drive it with
  `await t.app.inject({ method, url, headers: t.auth, payload })`. `close()` is
  async — `await t.close()` in `afterEach`, or push to an array and close in
  `afterAll` like `test/http/ops.test.ts` does.
- `r.statusCode`, `r.body` (string), `r.headers["content-type"]`, and
  `JSON.parse(r.body)` are how you read an inject reply.
- Imports carry a `.js` extension (`../../src/types.js`) — this is Node ESM.
  From `test/dashboard/`, the source tree is `../../src/…`.
- Job states: `PENDING`, `CLAIMED`, `RUNNING`, `FAILED`, `SUCCEEDED`,
  `DEAD_LETTER`, `CANCELLED`.
- **Driving a job by hand, with no worker running** (this is how §D3–§D5 set
  up): `queue.registerWorker("w1")`, then `queue.claimNext("w1")` returns the
  job, then `queue.startJob(id, "w1")` puts it in `RUNNING`. From there
  `queue.completeJob(id, "w1")` succeeds it and `queue.failJob(id, "w1", "boom")`
  fails it — on a job enqueued with `maxAttempts: 1` that one failure lands it
  straight in `DEAD_LETTER`.
- `queue.updateProgress` takes **positional** arguments, not an object:
  `queue.updateProgress(jobId, "w1", done, total, note)`. It only works on a
  `RUNNING` job claimed by that worker, and returns `true` when it wrote.

---

## §D0 — What the planning lane already built (read once, do not rebuild)

Committed as `feat(D0)`, gated green. Nothing in this section is a task.

- `src/dashboard/index.html` — the whole page. Inline `<style>` and `<script>`,
  a dark ops palette that flips under `prefers-color-scheme: light`, and **zero
  external requests**: no CDN, no web font, no framework, no build step. Panels:
  queue depth by state (`id="tiles"`), throughput by type (`id="bytype"`),
  running jobs with live progress bars (`id="running"`), the dead-letter queue
  with requeue buttons (`id="dlq"`), the worker lease table (`id="workers"`),
  and the event feed (`id="feed"`).
- `src/dashboard/index.ts` — `dashboardHtml()`, which reads that file from disk
  once and caches the string.
- `src/routes/dashboard.ts` — `GET /`, serving it as
  `text/html; charset=utf-8` with `cache-control: no-store`.
- `src/app.ts` — registers the route and adds `/` to `PUBLIC_PATHS`.

The page reads `/stats` and `/jobs?state=DEAD_LETTER` on a 2s poll, streams
`/events` with `fetch` (not `EventSource` — the stream wants a header), and
posts `/jobs/:id/cancel` and `/jobs/:id/requeue` from its buttons. It needs no
new server route and no new queue method.

**Reservations recorded here:**

- **`GET /` is unauthenticated, joining `/healthz`.** The shell carries no queue
  data, and a browser cannot put an `Authorization` header on a top-level
  navigation, so gating the page would make the dashboard unreachable exactly
  when a bearer token is configured. Every byte of data it displays it fetches
  itself, with the header, through the gated routes. This refines the §C0
  reservation that `/healthz` was the only open route.
- **The token lives in `sessionStorage`**, typed into the header bar, which the
  page reveals when a request comes back 401.
- **The page is a real `.html` file, not a TypeScript string**, because SPEC
  feature 8 says hand-written file with no build step. `dashboardHtml()` finds
  it next to the module first and at `src/dashboard/index.html` second, so it
  resolves whether the server runs from `src/` or from a built `dist/`.
- **Phase D's page was carried by the planning lane, not the executor** — a
  600-line self-contained HTML page is not one local session, and pasting it
  into this spec would be transcription rather than delegation.

---

## §D1 — The dashboard shell is served on `GET /`

**File to create:** `test/dashboard/page.test.ts`
**Pattern file:** `test/http/ops.test.ts` (its `describe` / `beforeEach` /
`afterAll` shape and its use of `t.app.inject`).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

Use `testApp()` with no overrides for the first three assertions.

Assertions (5):

1. `GET /` answers 200 and its `content-type` header matches `text/html`.
2. The body starts with `<!doctype html` (case-insensitively) and contains
   `<title>worklane`.
3. The body contains the six panel ids the page renders into — `id="tiles"`,
   `id="bytype"`, `id="running"`, `id="dlq"`, `id="workers"`, `id="feed"`.
4. On a **second** app built with `testApp({ bearerToken: "0123456789abcdef0123" })`,
   `GET /` **with no Authorization header** still answers 200 — the shell is
   public.
5. On that same token-carrying app, `GET /stats` with no Authorization header
   answers 401 — the data behind the shell is not public.

---

## §D2 — The page is self-contained: zero external requests

**File to create:** `test/dashboard/self-contained.test.ts`
**Pattern file:** `test/dashboard/page.test.ts` from §D1.
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

Do not do path arithmetic to find the file. Import `dashboardHtml` from
`../../src/dashboard/index.js` and assert against the string it returns. This
proves the loader at the same time.

The point of this test is that the SPEC non-goal holds forever: nothing on this
page is fetched from anywhere else. If someone later adds a CDN script tag or a
web font, this test is what fails.

Assertions (5):

1. `dashboardHtml()` returns a string longer than 5000 characters that starts
   with `<!doctype html` (case-insensitively).
2. It contains no `http://` and no `https://` anywhere — search the whole
   string, comments included.
3. It contains no `<script` tag carrying a `src=` attribute, and no `<link`
   element at all — nothing is loaded from elsewhere.
4. It contains no `@import` and no `fonts.` reference, and it does not mention
   `react` or `vue` (case-insensitively) — no framework, no web font. (Do not
   also assert on the string `cdn`: the stylesheet's opening comment says "no
   CDN", so that check would fail on a page that is in fact correct.)
5. It contains an inline `<style>` block and an inline `<script>` block, and the
   body returned by `GET /` on a `testApp()` is exactly equal to
   `dashboardHtml()`.

---

## §D3 — Live progress, the way the progress bars read it

**File to create:** `test/dashboard/progress.test.ts`
**Pattern file:** `test/http/events.test.ts` (for `listenTestApp` +
`readSseEvents`) and `test/http/ops.test.ts` (for `/stats`).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

SPEC feature 7 ends "a running handler can report progress and the API serves it
live" — this is the test of that claim, and of the data the running-jobs panel
draws its bars from. Drive the job by hand with the recipe at the top of this
doc; no worker is running.

Enqueue a `demo` job, claim it, start it, then call
`queue.updateProgress(id, "w1", 3, 10, "step 3 of 10")`.

Assertions (4):

1. `GET /jobs/:id` answers 200 and its `job` has `progressDone` 3,
   `progressTotal` 10 and `progressNote` `"step 3 of 10"`.
2. `GET /stats` answers 200 and its `running` array contains that job, carrying
   the same three progress fields and a `workerId` of `"w1"` — the running
   panel needs all four.
3. A later `queue.updateProgress(id, "w1", 7, 10, "step 7 of 10")` is reflected
   by the next `GET /stats`: `progressDone` is now 7. (The bar moves.)
4. Over the SSE stream — `listenTestApp(t)`, then `readSseEvents(url + "/events?replay=0", { count: 1, onOpen })`
   where `onOpen` calls `updateProgress` again — an event arrives whose `kind`
   is `"progress"` and whose `jobId` is that job.

---

## §D4 — The dead-letter panel and its requeue button

**File to create:** `test/dashboard/dead-letter.test.ts`
**Pattern file:** `test/http/verbs.test.ts`.
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

The panel lists `GET /jobs?state=DEAD_LETTER&limit=50` and each row's button
posts `/jobs/:id/requeue`. Prove that pair. Enqueue two jobs: one with
`maxAttempts: 1` that you drive to `DEAD_LETTER` (claim, start, `failJob`), and
one that stays `PENDING`.

Assertions (4):

1. `GET /jobs?state=DEAD_LETTER` answers 200 and its `jobs` array holds exactly
   one entry — the dead-lettered job's id. The `PENDING` job is not in it.
2. That entry carries the columns the panel prints: `type`, a numeric `attempts`
   and `maxAttempts`, and a non-null `lastError` string.
3. The same response's `stats.deadLetter` is 1.
4. After `POST /jobs/:id/requeue` on that job, a fresh
   `GET /jobs?state=DEAD_LETTER` answers with an empty `jobs` array, and
   `GET /jobs/:id` shows the job back in state `PENDING`.

---

## §D5 — The worker lease table

**File to create:** `test/dashboard/workers.test.ts`
**Pattern file:** `test/http/ops.test.ts` (it already reads `/stats` and
`/metrics`).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

The workers panel prints one row per registered worker: its id, when it
started, its last heartbeat, and which job it is holding. That is the `workers`
array on `/stats`; `/metrics` publishes the same thing as gauges. No worker
runs in a `testApp()`, so register one by hand.

Assertions (4):

1. On a fresh `testApp()`, `GET /stats` answers with an empty `workers` array.
2. After `queue.registerWorker("w1")`, `GET /stats` has exactly one worker whose
   `id` is `"w1"`, whose `startedAt` and `lastHeartbeat` are numbers, and whose
   `claimedJobId` is `null`.
3. After enqueuing a job and calling `queue.claimNext("w1")`, that worker's
   `claimedJobId` on `/stats` equals the claimed job's id; after
   `queue.startJob(id, "w1")` and `queue.completeJob(id, "w1")` it is `null`
   again.
4. `GET /metrics` contains a `worklane_workers 1` line, and its
   `worklane_workers_busy` line reads `1` while the worker holds the job and `0`
   once the job is complete.

---

## §D6 — Phase verify

**Files to edit:** `STATUS.md` (append only), `ROADMAP.md` (row edits).
**Touch no source files. Create no test files.**
**Gate:** `bash scripts/verify.sh`

1. Run `bash scripts/verify.sh`. It must end `verify: all gates green`. (The
   README lint still reports that `README.md` is not written yet — that is
   expected; it is Phase E's job, and the script skips the lint, it does not
   fail.)
2. **Append** a `## Phase D — the dashboard, proven (2026-08-24)` section to the
   end of `STATUS.md`, in the shape of the Phase C section already there: one
   short paragraph on what is now proven, a bullet per test file with its
   assertion count, and a final line naming the gates and the total test count
   `pnpm test` reported.
3. In `ROADMAP.md`, edit **row 8** (Dashboard) to status `SHIPPED`, phase `D`,
   with a note naming the test files that prove it. Change nothing else in the
   table.
4. Commit `STATUS.md` and `ROADMAP.md` only. (The reservations ledger below the
   table is already current — the planning lane recorded this phase's `GET /`
   reservation there. Add nothing to it.)
