# Phase E — deploy-grade packaging, and the door a stranger walks through

Phases A–D built and proved the queue, the workers, real cancel, the ops
surface and the dashboard. Phase E is SPEC feature 9 — YAML config, a systemd
example, the README quickstart, and CI — plus the last row on the scoreboard.
**The config loader and `docs/PROCESS.md` are already written and committed**
(see §E0); the tasks below prove the loader and write the packaging around it.

**The gate for every task in this phase:**
`pnpm typecheck` clean, `pnpm test` green, `bash scripts/scrub-check.sh` clean.
(§E3 and §E6 use `bash scripts/verify.sh`, which runs all three plus a README
lint.)

**Things that are true everywhere in this phase — do not go looking them up:**

- Vitest runs with the **repository root as the working directory**, so a test
  may open `deploy/worklane.example.yaml` by that exact relative path.
- `scratchDir()` in `test/helpers.ts` returns `{ path, cleanup }` — a temp
  directory outside the repo. Use it for any file a test writes; never write a
  scratch file into the repo.
- Imports carry a `.js` extension (`../../src/config.js`) — this is Node ESM.
- **This repository is public.** No home paths, no LAN addresses, no private
  hostnames — in files or commit messages. `scrub-check` fails the gate on them.
  Documentation examples use `localhost` and `192.0.2.x` only.

---

## §E0 — What the planning lane already built (read once, do not rebuild)

Committed as `feat(E0)` / `docs(E0)`, gated green. Nothing here is a task.

- `src/config.ts` — `parseYamlSubset(text, source?)`, `loadConfigFile(path)`,
  `resolveConfig(argv, env?)`. The config is a flat map of scalars, so instead
  of a parser dependency this reads a documented YAML subset: one `key: value`
  per line at column zero, `#` comments, a leading `---`, and scalars only
  (bare / `"double"` / `'single'` strings, ints, floats, `true`/`false`,
  `null`/`~`).
- `src/errors.ts` — `ConfigError`, thrown for every config failure.
- `src/server.ts` — resolves config at startup and prints which source it used.
- `deploy/worklane.example.yaml` — every key with its default and why it exists.
- `docs/PROCESS.md` — the loop story and the planning-tier experiment result.

**Reservations recorded here:**

- **The YAML subset is strict on purpose.** Indentation, sequences, inline
  collections, anchors and block scalars each raise a `ConfigError` naming the
  file and line — a config worklane cannot read is an error, never a silent
  misreading. Unknown keys are rejected too, and the message lists the known
  ones; a typo that quietly keeps a default is the worst kind of config bug.
  A `null` value means "use the default".
- **Config precedence is `--config <path>` > `WORKLANE_CONFIG` > built-in
  defaults**, and an unrecognised command-line argument is an error rather than
  something ignored.
- **`pnpm build` copies `src/dashboard/index.html` into `dist/dashboard/`** so a
  built tree serves the dashboard without the source tree beside it. This is a
  file copy, not a build step for the page: the HTML is still hand-written and
  served byte-for-byte (SPEC feature 8).
- **The example config ships no bearer token.** An example token in a public
  repo is worse than none; the key is present but commented out.
- **Phase E's loader and PROCESS.md were carried by the planning lane** — code
  the planner has already written is the planner's, and pasting it into this
  spec for the executor to re-type would be transcription, not delegation.

---

## §E1 — The config loader, proven

**File to create:** `test/config/load.test.ts`
**Pattern file:** `test/db/queue.test.ts` (its `describe` / `it` / `expect`
shape).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

Import `parseYamlSubset`, `loadConfigFile` and `resolveConfig` from
`../../src/config.js`, and `ConfigError` from `../../src/errors.js`. Write any
temp config files into `scratchDir()`, and call its `cleanup()` when done.

`parseYamlSubset(text)` returns a plain object. `loadConfigFile(path)` returns a
validated `Config`. `resolveConfig(argv, env)` returns `{ config, source }`,
where `source` is the file path or the string `built-in defaults`.

Assertions (6):

1. `parseYamlSubset` reads each scalar kind from one small document: a bare
   string, an integer, `true`, `null`, a `"double quoted"` value that carries a
   trailing `# comment`, and an empty `""`. Check the parsed types, not just the
   values — the integer must be a `number`, not `"4"`.
2. `loadConfigFile("deploy/worklane.example.yaml")` returns a config whose
   `workerCount` is 4, `httpPort` is 8080 and `dbPath` is `./worklane.sqlite`,
   and whose `leaseDurationMs` is 30000 — a key the file sets and a key it
   leaves to the default both come back right.
3. A scratch file containing a misspelled key (say `workerCont: 3`) makes
   `loadConfigFile` throw a `ConfigError` whose message contains that
   misspelled key.
4. A scratch file containing `workerCount: 0` makes `loadConfigFile` throw a
   `ConfigError` — the schema rejects it, and the error is not a raw `ZodError`.
5. Each of these three documents makes `parseYamlSubset` throw a `ConfigError`
   whose message names the offending line number: an indented second line, a
   line beginning `- `, and a value written as an inline `{ }` collection.
6. `resolveConfig([], {})` reports `source` as `built-in defaults`;
   `resolveConfig(["--config", "deploy/worklane.example.yaml"], {})` and
   `resolveConfig([], { WORKLANE_CONFIG: "deploy/worklane.example.yaml" })` both
   report that path as `source` and give `workerCount` 4; and
   `resolveConfig(["--nope"], {})` throws a `ConfigError`.

---

## §E2 — The systemd unit

**File to create:** `deploy/worklane.service`
**Pattern file:** `deploy/worklane.example.yaml` — match its tone: a comment
header that says how to use the file, then the content, commented where a
choice is not obvious.
**Touch no source files. Create no test files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

A worked example an operator can copy to `/etc/systemd/system/`, edit, and
enable. Write a real systemd unit with `[Unit]`, `[Service]` and `[Install]`
sections. What it must express:

- It starts after the network is up, and it is wanted by the normal multi-user
  target.
- **These three literals are the contract with the README and with §E5 — use
  them exactly:** the working directory is `/opt/worklane`, the config file is
  `/etc/worklane/worklane.yaml`, and `ExecStart` runs node against
  `/opt/worklane/dist/server.js` with `--config` pointing at that config path.
- It runs as a dedicated unprivileged user and group, not root.
- **Stopping must drain, not kill.** worklane's entry point catches `SIGTERM`
  and drains its workers before exiting, so systemd must send `SIGTERM` and then
  wait — allow it about 30 seconds before systemd loses patience.
- It restarts on failure after a short delay.
- Standard service hardening: no new privileges, a private `/tmp`, a read-only
  system, and no access to home directories — with one writable state directory
  for the SQLite file and the ledger.
- A comment header giving the three commands that install it (copy,
  `systemctl daemon-reload`, `systemctl enable --now`), and a note that the
  config's `dbPath` and `ledgerPath` should be **absolute** paths under that
  state directory, because a relative path resolves against the working
  directory.

Nothing in this file may contain a home path or a LAN address.

---

## §E3 — The README

**File to create:** `README.md`
**Pattern file:** `docs/PROCESS.md` — match its register: plain sentences, no
marketing, headings that say what the section is.
**Touch no source files. Create no test files.**
**Gate:** `bash scripts/verify.sh` (typecheck + tests + scrub + the README lint)

The README is the front door. SPEC.md's definition of done is "a stranger
follows the README: demo jobs queued in 5 minutes; progress bars move; a cancel
kills a real process by signal with the kill recorded; a dead-lettered job comes
back with one verb."

`scripts/verify.sh` lints for four literal strings — the file must contain
`## Quickstart`, `pnpm install`, `curl`, and `cancel`. Grep the lint block in
`scripts/verify.sh` if you want to see it.

Sections to write:

1. **What worklane is** — a single-box durable job queue on SQLite with real
   workers, real cancel and a live dashboard. Say plainly that it is one box,
   one SQLite file, N workers in one process, and that delivery is
   **at-least-once**.
2. **## Quickstart** — the five-minute path, as numbered shell steps:
   `pnpm install`, `pnpm build`, start the server (mention `--config` and that
   with no config it uses built-in defaults on port 8080), open
   `http://localhost:8080/` for the dashboard, then `curl` to enqueue a couple
   of `demo` jobs — payload `{"steps":20,"stepMs":250}` to
   `POST /jobs` — and watch the bars move. Then `curl` a `POST /jobs/:id/cancel`
   on a running job and read the `signal` field the reply carries back.
3. **The HTTP surface** — a small table: `POST /jobs`, `GET /jobs`,
   `GET /jobs/:id`, `POST /jobs/:id/cancel`, `POST /jobs/:id/requeue`,
   `GET /healthz`, `GET /stats`, `GET /metrics`, `GET /events`, `GET /`. One
   line each. Note that a configured bearer token is required on all of them
   except `/healthz` and `/`, sent as `Authorization: Bearer …`.
4. **Configuration** — point at `deploy/worklane.example.yaml`, state the
   precedence (`--config` beats `WORKLANE_CONFIG` beats defaults), and describe
   the YAML subset in two sentences: a flat map of `key: value` scalars, and
   anything outside it is a startup error naming the line.
5. **Deploying** — point at `deploy/worklane.service`.
6. **Handlers** — the extension point: register a handler for a job type; `exec`
   and `demo` ship with it.
7. **Development** — `pnpm typecheck`, `pnpm test`, `bash scripts/verify.sh`.
8. **How this was built** — one paragraph linking `docs/PROCESS.md`.

Use `localhost` in every example. No LAN addresses, no home paths.

---

## §E4 — Continuous integration

**File to create:** `.github/workflows/ci.yml`
**Pattern file:** none in this repo — write a standard GitHub Actions workflow.
**Touch no source files. Create no test files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

One workflow, one job, running every gate this repository has. What it must do:

- Trigger on pushes and on pull requests.
- Run on `ubuntu-latest`.
- Check out the repository, install **pnpm version 9** (`pnpm/action-setup`),
  set up **Node 22** (`actions/setup-node`) with pnpm caching enabled, install
  with a frozen lockfile, and then run the whole gate as a single step:
  **`bash scripts/verify.sh`** — use that exact command, it is what §E5 checks
  for.
- Nothing else. The tests need no services, no network and no GPU; they spawn
  real short-lived child processes from `test/fixtures/`, which is all a plain
  runner provides.

Give the job a name that reads well in a status check, and comment the one
non-obvious line: the whole gate is one script so CI and a laptop cannot drift.

---

## §E5 — The packaging, proven

**File to create:** `test/deploy/packaging.test.ts`
**Pattern file:** `test/dashboard/self-contained.test.ts` (it reads a file and
asserts on the string).
**Touch no source files.**
**Gate:** `pnpm typecheck` + `pnpm test` + `bash scripts/scrub-check.sh`

The three files this phase writes are documentation that can rot. This test is
what notices. Read each file with `readFileSync(path, "utf8")` using the plain
repo-root-relative path; import `loadConfigFile` from `../../src/config.js`.

Assertions (5):

1. `loadConfigFile("deploy/worklane.example.yaml")` succeeds, and the config it
   returns has `bearerToken` `undefined` — the shipped example must never carry
   a token.
2. `deploy/worklane.service` contains the section headers `[Unit]`, `[Service]`
   and `[Install]`, and a `WantedBy=multi-user.target` line.
3. That same file has an `ExecStart=` line mentioning both `dist/server.js` and
   `--config`, and the file mentions `/etc/worklane/worklane.yaml`,
   `/opt/worklane`, a `User=` line and a `TimeoutStopSec=` line — worklane
   drains on `SIGTERM`, so a stop timeout is not optional.
4. `.github/workflows/ci.yml` contains `ubuntu-latest`, `pnpm install`, the
   exact string `bash scripts/verify.sh`, and `22` (the Node version).
5. `README.md` contains all four strings the `verify.sh` lint requires —
   `## Quickstart`, `pnpm install`, `curl`, `cancel` — and links to both
   `docs/PROCESS.md` and `deploy/worklane.example.yaml`.

---

## §E6 — Phase verify, and the last row on the scoreboard

**Files to edit:** `STATUS.md` (append only), `ROADMAP.md` (row edits).
**Touch no source files. Create no test files.**
**Gate:** `bash scripts/verify.sh`

1. Run `bash scripts/verify.sh`. It must end `verify: all gates green`. The
   README lint now runs for real instead of skipping — if it fails, `README.md`
   is missing one of its four required strings; fix the README, not the script.
2. **Append** a `## Phase E — deploy-grade packaging (2026-08-24)` section to
   the end of `STATUS.md`, in the shape of the Phase D section already there:
   one short paragraph on what now exists, a bullet per file this phase shipped,
   and a final line naming the gates and the total test count `pnpm test`
   reported. End it with one sentence stating that every ROADMAP row now reads
   SHIPPED.
3. In `ROADMAP.md`, edit **row 9** (Deploy-grade packaging) to status `SHIPPED`,
   phase `E`, with a note naming the config loader, the systemd unit, the README
   and the CI workflow. That is the only row left to flip — every other row,
   including `docs/PROCESS.md`, already reads SHIPPED. Change nothing else in
   the table.
4. Commit `STATUS.md` and `ROADMAP.md` only. Add nothing to the reservations
   ledger — the planning lane already recorded this phase's reservations there.
