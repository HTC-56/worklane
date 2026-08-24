# How this repository was built

worklane was written end to end by an autonomous coding loop. No human typed a
line of its source. This document is the honest account of that: the
architecture of the loop, what it cost, what the models could and could not
carry, and the result of the pre-registered planning-tier experiment recorded in
`DECISIONS.md`.

It is written for someone deciding whether to run a loop like this themselves,
so it reports the failures at the same resolution as the successes.

## The two lanes

The loop has exactly two moving parts and one contract between them.

**The executor lane** runs a local 35B model (`qwen3.6-35b-a3b`, 64k context) in
a fresh session, over and over. Its whole prompt is `LOOP_PROMPT.md`: read
`TODO.md`, take the first unchecked task that is not tagged `[CLAUDE]`, build
exactly that, run the gates, tick the box, commit. A session that cannot finish
writes `BLOCKED.md` and stops. A session may not ask a question — there is
nobody to answer it.

**The planning lane** wakes when `TODO.md` has no unchecked tasks left. It reads
the scoreboard (`ROADMAP.md`), the history (`STATUS.md`), the fence
(`DECISIONS.md`), and the record of what the executor has actually failed at,
then writes the next phase: a `TASK_PHASE_<letter>.md` spec plus 4–8 checkbox
tasks appended to `TODO.md`. It may only derive work the spec documents already
call for. Anything `DECISIONS.md` marks human-gated it must refuse, and when
every spec row is built its job is to declare the project complete rather than
invent scope.

**The contract is `TODO.md`.** It is the one file every executor session reads
whole, so it is kept deliberately thin: three lines per task naming what to
build, which file, which gate, and which phase-doc section holds the detail. The
detail lives in greppable `## §D3 — <title>` sections the executor finds with
`grep` and reads with `offset`/`limit`. It never reads a document whole, and it
never reads `SPEC.md` at all.

Three shell gates decide whether a session succeeded, and the model cannot argue
with them: `pnpm typecheck`, `pnpm test`, `bash scripts/scrub-check.sh`.
`scripts/verify.sh` composes all three plus a README lint and is what closes a
phase. Red is not done — the executor is instructed to fix twice, then block.

A supervising script tails each session. If a session edits files, passes the
gates, and then dies before committing, the supervisor sweep-commits the
stranded work (`chore(loop): sweep-commit stranded work after task: …`). Two of
the twenty executor sessions ended that way.

## What it cost

Every session appends a row to a ledger: timestamp, lane, model, result, turns,
output tokens, tool calls, file edits, duration, task. The whole build — scaffold
through the dashboard — ran in a single day, 07:02 to 12:09.

| Lane | Sessions | Committed | Rate | Output tokens |
|---|---|---|---|---|
| executor (local 35B) | 20 | 18 | 90% | 506k |
| planning (frontier) | 3 | 3 | 100% | 390k |
| planning (free tier) | 3 | 0 | 0% | 89k |

Per phase, the executor's rate was 6/7 (B), 7/7 (C), 5/6 (D). The two misses
were both recovered by the sweep-commit; neither task needed re-planning.

A sanitized excerpt of the ledger — the columns are
`time · lane · model · result · turns · out_tok · tools · edits · dur_s`:

```
07:40:31  plan  frontier  commit   75  175170  36   0   936   plan next phase
07:50:13  loop  qwen      commit   77   21520  31  12   516   B1 enqueue, dedupe and parent validation
08:04:20  loop  qwen      no-op   109   21992  41   9   104   B4 a child waits for its parent
08:09:29  loop  qwen      commit  108   33468  41  12   308   B5 cancelling a job cancels its children
08:58:12  loop  qwen      commit   56   22133  20   7  1049   C1 enqueue and inspect over HTTP
11:03:01  loop  qwen      commit  131   28280  49  14  1590   C6 demo handler that reports progress
11:39:33  loop  qwen      commit   34    6831  13   3   590   D1 the dashboard shell on GET /
12:09:19  loop  qwen      commit   65   10409  25   5    90   D6 phase verify
```

The executor averaged 96 turns and 37 tool calls per session — it is a slow,
chatty worker that re-greps rather than remembers. That is the correct trade at
64k of context, and the reason the task specs name exact file paths: every
lookup it does not have to perform is context it keeps for the work.

## Who actually wrote what

This is the number most reports of this kind quietly skip.

Of 38 commits, **20 are the executor's** and 18 are the planning lane's. By
volume the split runs the other way: `src/` is 3.3k lines and almost all of it —
the queue, the workers, the exec handler, the HTTP surface, the 876-line
dashboard page — was written by the planning lane. `test/` is 2.0k lines and
1.4k of those are the executor's: it wrote the great majority of the suite that
proves the product works.

That split is deliberate, and it is the correction to a pathology the loop hit
partway through. To guarantee a local session would succeed, the planner had
started pre-writing and pre-verifying every code body and pasting it verbatim
into the phase spec — so the executor's "task" was to re-type it character for
character. That spends frontier tokens writing the code twice and then books the
result as a local carry. The ledger lies, and the lie flatters the loop.

The rule since (locked in the planner's own contract, 2026-08-20): code the
planner has already written is the *planner's*, and it commits it under its own
name; a phase spec may never contain a whole function for the executor to copy.
What the executor gets is work it genuinely authors from an intent-level spec —
test assertions described in prose, docs, gate runs, small focused edits against
a named pattern file. A local task that fails is information about the 35B
ceiling. A transcription task that succeeds is noise. The loop prefers the
honest failure.

## What the 35B model could and could not carry

The 90% commit rate is real, but it is a rate over tasks *shaped* for the model,
and the shaping is the finding:

- **One file, one session.** Every successful task created or edited a single
  file (plus ticking `TODO.md`). Multi-file tasks were the planner's.
- **Prose assertions beat prose requirements.** "Assert that `/stats` has one
  worker whose `claimedJobId` equals the claimed job's id" lands. "Prove the
  lease table works" does not.
- **Name the pattern file.** Every task cites exactly one precedent file to
  mirror. "Mirror existing patterns" is a failed spec.
- **Do not chain cross-references.** A task that cites four other sections
  exceeds what the model can hold at once; the rule is one citation, and
  otherwise restate the rule in a sentence.
- **The context budget is the real constraint.** An early phase averaged ~475
  tokens per `TODO.md` checkbox; since `TODO.md` is read whole every session,
  that alone crowded out the work. Checkboxes are now ~60 words.

Routing tasks to the frontier model is the escape hatch, and it was overused:
one stretch tagged ~30% of tasks for escalation and the local loop completed
zero of them, because the executor skips escalated tasks and stalls the moment
one is next in line. The standing target is at most two escalated tasks per
phase and never two adjacent — the local lane must always have a reachable next
task.

## The planning-tier experiment

Pre-registered in `DECISIONS.md` before Phase A: this repository's planning lane
would run a **zero-cost hosted model**, while a sibling control project ran a
frontier model in the same role. The comparison to report was executor
commit-rate under each planner. The commitment was to publish the result either
way.

**The result is a null result, and not the interesting kind.** The zero-cost
planner never produced a phase plan to measure. Three consecutive planning runs
died the same way: the stream delivered a handful of events, went silent for
120 seconds, and the non-streaming retry came back malformed — each time roughly
30–90 turns and 17–40k output tokens into a generation, with nothing committed.
The lane's usage-limit detector read the stalls as throttling and backed off.

The honest conclusion is narrower than the question asked. It is **not** "a free
model cannot plan." It is that free-tier hosted inference did not sustain a
generation of planning length — tens of thousands of output tokens in one
session — on the days it was tried. Planning quality was never measured, because
no plan was ever produced. Per the pre-registered rule, the lane re-tiered to the
frontier default the same day; every phase plan in this repository came from
that tier.

The escalation ladder still starts at zero cost, where the generations are short
enough that the failure mode above does not apply, and is measured separately.

One thing the experiment did establish, though it was not the hypothesis: the
loop's failure handling is load-bearing. Three dead planning sessions cost the
project nothing but time, because a session that dies without committing leaves
the repository exactly as it found it. The gates, the append-only documents, and
the "commit or write `BLOCKED.md`" contract are what make an unattended loop safe
to run with a model that fails often.

## If you want to run one

The parts that mattered, in rough order of how much they mattered:

1. **A machine-checkable definition of done.** Three shell commands the model
   cannot talk its way past.
2. **A frozen spec and an explicit fence.** `SPEC.md` is the whole product;
   `DECISIONS.md` lists what only a human may decide. The planner's hardest
   instruction is that finishing is success — when the scoreboard is full it
   must declare completion, not find more work.
3. **A scoreboard, not a narrative.** `ROADMAP.md` is one row per spec feature.
   It is the fastest true picture of what is built, and it is why a planning
   session can start without re-reading the entire project.
4. **A context budget written into the contract**, and enforced by the planner
   on itself.
5. **A ledger.** Without per-session rows there is no way to tell a loop that is
   working from a loop that is looking busy — and no way to catch yourself
   booking your own work as the local model's.
