import type { KillSignal } from "./types.js";

/** Enqueue rejected: an active job already holds this dedupe key. */
export class DuplicateJobError extends Error {
  readonly dedupeKey: string;
  readonly existingJobId: number;

  constructor(dedupeKey: string, existingJobId: number) {
    super(`duplicate dedupe key "${dedupeKey}" (active job ${existingJobId})`);
    this.name = "DuplicateJobError";
    this.dedupeKey = dedupeKey;
    this.existingJobId = existingJobId;
  }
}

/** Enqueue rejected: the named parent does not exist. */
export class UnknownParentError extends Error {
  constructor(parentId: number) {
    super(`parent job ${parentId} not found`);
    this.name = "UnknownParentError";
  }
}

/**
 * A handler stopped because its context signal aborted. Carries the signal
 * that actually ended the child process so cancel can be recorded honestly.
 */
export class JobCancelledError extends Error {
  readonly killSignal: KillSignal;

  constructor(killSignal: KillSignal) {
    super(`cancelled by ${killSignal}`);
    this.name = "JobCancelledError";
    this.killSignal = killSignal;
  }
}

/** The exec child process ended in a way that counts as a failed attempt. */
export class ExecFailedError extends Error {
  readonly exitCode: number | null;
  readonly termSignal: string | null;
  readonly timedOut: boolean;

  constructor(
    message: string,
    exitCode: number | null,
    termSignal: string | null,
    timedOut: boolean,
  ) {
    super(message);
    this.name = "ExecFailedError";
    this.exitCode = exitCode;
    this.termSignal = termSignal;
    this.timedOut = timedOut;
  }
}
