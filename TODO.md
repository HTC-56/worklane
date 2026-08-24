# Loop tasks

Ordered; each is one short session. Work the first unchecked box. Each task is
fully specced in ONE greppable section of its phase doc (`TASK_PHASE_A.md` §A1,
§A2, …) — grep your section, read it, build it.

*(no tasks yet — the planning lane authors Phase A from SPEC.md)*

## Phase B: prove the queue — see TASK_PHASE_B.md

Phase A (queue, workers, exec, real cancel) is committed and green; Phase B
covers what its tests do not, and finishes chains. Grep your section in
`TASK_PHASE_B.md`, read it, build it. Gate for every task below:
`pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`.

- [x] **B1** Enqueue, dedupe and parent validation — create `test/db/queue.test.ts`, mirroring `test/workers/worker.test.ts`. 6 assertions. Spec: `TASK_PHASE_B.md` §B1.
- [x] **B2** Retry ladder, dead letter, requeue — create `test/db/retry.test.ts`, mirroring `test/db/queue.test.ts`. 5 assertions. Spec: §B2.
- [x] **B3** Lease lapse returns a job to the queue — create `test/db/lease.test.ts`, mirroring `test/db/queue.test.ts`. 4 assertions. Spec: §B3.
- [x] **B4** A child waits for its parent — create `test/db/chains.test.ts`, mirroring `test/db/queue.test.ts`. 4 assertions. Spec: §B4.
- [x] **B5** Cancelling a job cancels its children — edit `src/db/queue.ts` (mirror its own `markCancelled`), create `test/db/chains-cascade.test.ts`. 4 assertions. Spec: §B5.
- [x] **B6** Dead-lettering a job dead-letters its children — edit `src/db/queue.ts` (mirror §B5's new method), create `test/db/chains-dlq.test.ts`. 4 assertions. Spec: §B6.
- [x] **B7** Phase verify — run `bash scripts/verify.sh`, append a Phase B section to `STATUS.md`, flip ROADMAP rows 1, 2, 4, 6 to SHIPPED. Spec: §B7.

## Phase C: the ops surface — see TASK_PHASE_C.md

The Fastify HTTP surface (verbs, `/healthz`, `/metrics`, `/events`, JSONL
ledger, bearer auth) is committed and green — `TASK_PHASE_C.md` §C0 says what
exists. These tasks prove it and add the demo handler the quickstart needs.
Grep your section in `TASK_PHASE_C.md`, read it, build it. Gate for every task:
`pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`.

- [x] **C1** Enqueue and inspect over HTTP — create `test/http/verbs.test.ts`, mirroring `test/db/queue.test.ts`. 6 assertions. Spec: `TASK_PHASE_C.md` §C1.
- [x] **C2** The bearer token — create `test/http/auth.test.ts`, mirroring `test/http/verbs.test.ts`. 4 assertions. Spec: §C2.
- [x] **C3** Cancel and requeue over HTTP — create `test/http/cancel-requeue.test.ts`, mirroring `test/http/verbs.test.ts`. 4 assertions. Spec: §C3.
- [x] **C4** healthz, stats and Prometheus metrics — create `test/http/ops.test.ts`, mirroring `test/http/verbs.test.ts`. 5 assertions. Spec: §C4.
- [x] **C5** SSE stream and JSONL ledger — create `test/http/events.test.ts`, mirroring `test/http/verbs.test.ts`; uses `listenTestApp` + `readSseEvents`. 4 assertions. Spec: §C5.
- [x] **C6** Demo handler that reports progress — create `src/handlers/demo.ts` (mirror `src/handlers/exec.ts`), register it in `src/runtime.ts`, create `test/handlers/demo.test.ts`. 4 assertions. Spec: §C6.
- [x] **C7** Phase verify — run `bash scripts/verify.sh`, append a Phase C section to `STATUS.md`, flip ROADMAP row 7 to SHIPPED. Spec: §C7.

## Phase D: the dashboard — see TASK_PHASE_D.md

`GET /` serves the whole self-contained dashboard page; it is committed and
green — `TASK_PHASE_D.md` §D0 says what exists. These tasks prove the page and
the four data paths its panels draw from. Grep your section in
`TASK_PHASE_D.md`, read it, build it. Gate for every task:
`pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`.

- [x] **D1** The dashboard shell on `GET /` — create `test/dashboard/page.test.ts`, mirroring `test/http/ops.test.ts`. 5 assertions. Spec: `TASK_PHASE_D.md` §D1.
- [x] **D2** The page is self-contained — create `test/dashboard/self-contained.test.ts`, mirroring `test/dashboard/page.test.ts`; asserts on `dashboardHtml()`. 5 assertions. Spec: §D2.
- [x] **D3** Live progress, the way the bars read it — create `test/dashboard/progress.test.ts`, mirroring `test/http/events.test.ts`. 4 assertions. Spec: §D3.
- [x] **D4** Dead-letter panel and its requeue button — create `test/dashboard/dead-letter.test.ts`, mirroring `test/http/verbs.test.ts`. 4 assertions. Spec: §D4.
- [x] **D5** The worker lease table — create `test/dashboard/workers.test.ts`, mirroring `test/http/ops.test.ts`. 4 assertions. Spec: §D5.
- [x] **D6** Phase verify — run `bash scripts/verify.sh`, append a Phase D section to `STATUS.md`, flip ROADMAP row 8 to SHIPPED. Spec: §D6.

## Phase E: deploy-grade packaging — see TASK_PHASE_E.md

The YAML config loader (`src/config.ts`), the shipped example config and
`docs/PROCESS.md` are committed and green — `TASK_PHASE_E.md` §E0 says what
exists. These tasks prove the loader and write the packaging around it: the
systemd unit, the README quickstart, and CI. Grep your section in
`TASK_PHASE_E.md`, read it, build it. Gate for every task:
`pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`.

- [ ] **E1** The config loader, proven — create `test/config/load.test.ts`, mirroring `test/db/queue.test.ts`. 6 assertions. Spec: `TASK_PHASE_E.md` §E1.
- [ ] **E2** The systemd unit — create `deploy/worklane.service`, matching the comment style of `deploy/worklane.example.yaml`. Spec: §E2.
- [ ] **E3** The README — create `README.md`, matching the register of `docs/PROCESS.md`. Gate is `bash scripts/verify.sh` (it lints the quickstart). Spec: §E3.
- [ ] **E4** Continuous integration — create `.github/workflows/ci.yml`: one job, pnpm 9 + Node 22, running `bash scripts/verify.sh`. Spec: §E4.
- [ ] **E5** The packaging, proven — create `test/deploy/packaging.test.ts`, mirroring `test/dashboard/self-contained.test.ts`. 5 assertions. Spec: §E5.
- [ ] **E6** Phase verify — run `bash scripts/verify.sh`, append a Phase E section to `STATUS.md`, flip ROADMAP row 9 to SHIPPED. Spec: §E6.
