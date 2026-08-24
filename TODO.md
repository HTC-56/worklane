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

- [ ] **B1** Enqueue, dedupe and parent validation — create `test/db/queue.test.ts`, mirroring `test/workers/worker.test.ts`. 6 assertions. Spec: `TASK_PHASE_B.md` §B1.
- [ ] **B2** Retry ladder, dead letter, requeue — create `test/db/retry.test.ts`, mirroring `test/db/queue.test.ts`. 5 assertions. Spec: §B2.
- [ ] **B3** Lease lapse returns a job to the queue — create `test/db/lease.test.ts`, mirroring `test/db/queue.test.ts`. 4 assertions. Spec: §B3.
- [ ] **B4** A child waits for its parent — create `test/db/chains.test.ts`, mirroring `test/db/queue.test.ts`. 4 assertions. Spec: §B4.
- [ ] **B5** Cancelling a job cancels its children — edit `src/db/queue.ts` (mirror its own `markCancelled`), create `test/db/chains-cascade.test.ts`. 4 assertions. Spec: §B5.
- [ ] **B6** Dead-lettering a job dead-letters its children — edit `src/db/queue.ts` (mirror §B5's new method), create `test/db/chains-dlq.test.ts`. 4 assertions. Spec: §B6.
- [ ] **B7** Phase verify — run `bash scripts/verify.sh`, append a Phase B section to `STATUS.md`, flip ROADMAP rows 1, 2, 4, 6 to SHIPPED. Spec: §B7.
