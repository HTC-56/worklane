import type { CancelDispatcher, KillSignal } from "../types.js";

interface RunningEntry {
  jobId: number;
  workerId: string;
  controller: AbortController;
  settled: Promise<KillSignal>;
  resolveSettled: (signal: KillSignal) => void;
}

/**
 * The in-process bridge between "cancel this job" and the worker that is
 * actually running it. Workers register a job for the length of its run; the
 * queue asks this registry to cancel, and waits to learn which signal did it.
 */
export class RunningJobs implements CancelDispatcher {
  private readonly entries = new Map<number, RunningEntry>();

  /** Called by a worker just before it hands a job to its handler. */
  register(jobId: number, workerId: string): AbortSignal {
    this.finish(jobId, "NONE");

    let resolveSettled: (signal: KillSignal) => void = () => {};
    const settled = new Promise<KillSignal>((resolve) => {
      resolveSettled = resolve;
    });
    const controller = new AbortController();

    this.entries.set(jobId, {
      jobId,
      workerId,
      controller,
      settled,
      resolveSettled,
    });
    return controller.signal;
  }

  /** Called by a worker once the job has left RUNNING, however it ended. */
  finish(jobId: number, signal: KillSignal): void {
    const entry = this.entries.get(jobId);
    if (!entry) return;
    this.entries.delete(jobId);
    entry.resolveSettled(signal);
  }

  /** Aborts a job's context without waiting for it to wind down. */
  abort(jobId: number): boolean {
    const entry = this.entries.get(jobId);
    if (!entry) return false;
    entry.controller.abort();
    return true;
  }

  /**
   * Aborts a running job and resolves with the signal that ended its child.
   * Returns "NONE" when the job is not running here, or when its handler
   * finished on its own before the abort landed.
   */
  async cancel(jobId: number): Promise<KillSignal> {
    const entry = this.entries.get(jobId);
    if (!entry) return "NONE";
    entry.controller.abort();
    return entry.settled;
  }

  has(jobId: number): boolean {
    return this.entries.has(jobId);
  }

  get size(): number {
    return this.entries.size;
  }
}
