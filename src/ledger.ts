import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { JobEvent, JobEventSink } from "./events.js";

/**
 * The append-only audit trail: one JSON object per line, one line per job
 * transition. Writes are synchronous appends — at worklane's one-box scale
 * that costs little and means a crash cannot lose the line that explains it.
 * The file is never committed; `.gitignore` and `scrub-check.sh` both say so.
 */
export class Ledger implements JobEventSink {
  readonly path: string;
  private failures = 0;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  publish(event: JobEvent): void {
    this.write(event);
  }

  write(event: JobEvent): void {
    try {
      appendFileSync(this.path, `${JSON.stringify(event)}\n`, "utf8");
    } catch {
      // A ledger that cannot be written must not stop jobs from running.
      this.failures += 1;
    }
  }

  /** How many appends were swallowed — surfaced by `/healthz`. */
  get writeFailures(): number {
    return this.failures;
  }
}
