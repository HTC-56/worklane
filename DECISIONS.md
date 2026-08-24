# Decisions

## Locked (2026-08-24, at scaffold)

- **SPEC.md is the whole product.** v1 is the nine features there, fenced by
  its non-goals. The planning lane derives phases from SPEC.md only; it never
  invents features. When every feature is built and gated, "PROJECT SPEC
  COMPLETE" is the desired terminal state — declare it, do not find more work.
- **Stack**: TypeScript + Fastify + Zod + Vitest + better-sqlite3, pnpm. The
  dashboard is one hand-written self-contained HTML file.
- **Gates**: `pnpm typecheck`, `pnpm test`, `bash scripts/scrub-check.sh` —
  green at every phase end; `verify.sh` composes them plus the README lint.
  No database files, ledgers, or job output ever committed.
- **Public-repo discipline from commit 1**: no private hostnames, no real LAN
  IPs (docs use `localhost` / `192.0.2.x`), no absolute home paths, no key
  material, no references to other private projects — in files AND commit
  messages.
- **Neutral git identity** until the publish decision (human-gated).
- **Planning-tier experiment (pre-registered)**: this repo's planning lane
  runs a zero-cost hosted model. If two consecutive phases produce executor
  commit-rates badly under the sibling control project's baseline, planning
  bumps one tier and the deviation is recorded in docs/PROCESS.md. The
  outcome is reported honestly either way.

## Experiment result — planning tier (recorded 2026-08-24, same day)

The zero-cost planning tier FAILED INFRASTRUCTURALLY before quality could be
measured: two consecutive planning runs (each ~30 turns / ~17k output tokens in)
died on mid-stream stalls — 6 stream events then 120s of silence, malformed
non-streaming retry — and the lane's usage-limit detector backed off. Verdict:
free-tier hosted streams do not sustain planning-length generations. Per the
pre-registered rule, planning re-tiered to the frontier default the same day.
Escalation remains on the zero-cost ladder (shorter generations; separately
measured). docs/PROCESS.md must report this outcome as the experiment's finding.

## Human-gated (never resolved by the loop)

- Publishing: remote creation, repo name confirmation, license (default
  intent: MIT), and the account it lives under.
- Any scope beyond SPEC.md v1.

## Open Questions

*(none — SPEC.md answers v1 in full)*
