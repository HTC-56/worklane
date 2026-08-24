# Roadmap — the v1 scoreboard

One row per SPEC.md feature. The planning lane keeps status current; row edits
here are the one permitted exception to append-only docs.

| # | Feature (SPEC.md) | Status | Phase | Note |
|---|---|---|---|---|
| 1 | Durable queue on SQLite (WAL) | NOT BUILT | — | |
| 2 | Worker claim loop (lease/heartbeat) | NOT BUILT | — | |
| 3 | Command execution (exec handler) | NOT BUILT | — | |
| 4 | Retries + dead letter | NOT BUILT | — | |
| 5 | Real cancel (SIGTERM→SIGKILL, recorded) | NOT BUILT | — | |
| 6 | Chains (parent/child) | NOT BUILT | — | |
| 7 | Ops surface (verbs, healthz, metrics, SSE, ledger, auth, progress) | NOT BUILT | — | |
| 8 | Dashboard | NOT BUILT | — | |
| 9 | Deploy-grade packaging (config, unit, README, CI) | NOT BUILT | — | |
| — | docs/PROCESS.md (loop story + planning-tier experiment) | NOT BUILT | — | written near the end |

When every row reads SHIPPED and verify.sh is green, the project is done — the
planning lane declares PROJECT SPEC COMPLETE rather than inventing scope.

## Reservations ledger — small deferred calls recorded inside phase specs

*(empty at scaffold; each entry names its home)*
