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

- [ ] **C1** Enqueue and inspect over HTTP — create `test/http/verbs.test.ts`, mirroring `test/db/queue.test.ts`. 6 assertions. Spec: `TASK_PHASE_C.md` §C1.
- [ ] **C2** The bearer token — create `test/http/auth.test.ts`, mirroring `test/http/verbs.test.ts`. 4 assertions. Spec: §C2.
- [ ] **C3** Cancel and requeue over HTTP — create `test/http/cancel-requeue.test.ts`, mirroring `test/http/verbs.test.ts`. 4 assertions. Spec: §C3.
- [ ] **C4** healthz, stats and Prometheus metrics — create `test/http/ops.test.ts`, mirroring `test/http/verbs.test.ts`. 5 assertions. Spec: §C4.
- [ ] **C5** SSE stream and JSONL ledger — create `test/http/events.test.ts`, mirroring `test/http/verbs.test.ts`; uses `listenTestApp` + `readSseEvents`. 4 assertions. Spec: §C5.
- [ ] **C6** Demo handler that reports progress — create `src/handlers/demo.ts` (mirror `src/handlers/exec.ts`), register it in `src/runtime.ts`, create `test/handlers/demo.test.ts`. 4 assertions. Spec: §C6.
- [ ] **C7** Phase verify — run `bash scripts/verify.sh`, append a Phase C section to `STATUS.md`, flip ROADMAP row 7 to SHIPPED. Spec: §C7.
