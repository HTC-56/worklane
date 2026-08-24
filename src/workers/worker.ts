import type { Queue } from "../db/queue.js";
import { JobCancelledError } from "../errors.js";
import type {
  Config,
  Handler,
  HandlerContext,
  Job,
  KillSignal,
  ProgressUpdate,
} from "../types.js";
import type { RunningJobs } from "./running-jobs.js";

export interface WorkerDeps {
  queue: Queue;
  handlers: Map<string, Handler>;
  config: Config;
  workerId: string;
  runningJobs: RunningJobs;
}

/**
 * One in-process worker: claim, lease, run, heartbeat, record. Several of
 * these share a Queue and a RunningJobs registry.
 */
export class Worker {
  readonly workerId: string;
  private readonly queue: Queue;
  private readonly handlers: Map<string, Handler>;
  private readonly config: Config;
  private readonly runningJobs: RunningJobs;
  private stopping = false;
  private currentJobId: number | null = null;
  private loop: Promise<void> | null = null;

  constructor(deps: WorkerDeps) {
    this.queue = deps.queue;
    this.handlers = deps.handlers;
    this.config = deps.config;
    this.workerId = deps.workerId;
    this.runningJobs = deps.runningJobs;
  }

  /** Starts the claim loop. The returned promise settles when it stops. */
  start(): Promise<void> {
    if (this.loop) return this.loop;
    this.stopping = false;
    this.loop = this.runLoop();
    return this.loop;
  }

  /**
   * Stops the loop. An in-flight job is aborted and handed back to the queue
   * untouched — shutdown is not a failed attempt.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.currentJobId !== null) this.runningJobs.abort(this.currentJobId);
    const loop = this.loop;
    if (loop) await loop;
    this.loop = null;
  }

  get busy(): boolean {
    return this.currentJobId !== null;
  }

  private async runLoop(): Promise<void> {
    this.queue.registerWorker(this.workerId);
    try {
      while (!this.stopping) {
        const claimed = this.queue.claimNext(this.workerId);
        if (!claimed) {
          await this.sleep(this.config.pollIntervalMs);
          continue;
        }
        await this.runJob(claimed);
      }
    } finally {
      this.queue.unregisterWorker(this.workerId);
    }
  }

  private async runJob(claimed: Job): Promise<void> {
    const job = this.queue.startJob(claimed.id, this.workerId);
    if (!job) return;

    const handler = this.handlers.get(job.type);
    if (!handler) {
      this.queue.deadLetterJob(
        job.id,
        this.workerId,
        `no handler registered for job type "${job.type}"`,
      );
      return;
    }

    const signal = this.runningJobs.register(job.id, this.workerId);
    this.currentJobId = job.id;
    let killSignal: KillSignal = "NONE";

    const ctx: HandlerContext = {
      jobId: job.id,
      workerId: this.workerId,
      signal,
      progress: (update: ProgressUpdate) => {
        this.queue.updateProgress(
          job.id,
          this.workerId,
          update.done,
          update.total,
          update.note,
        );
      },
      output: (stdout: string, stderr: string) => {
        this.queue.recordOutput(job.id, this.workerId, stdout, stderr);
      },
    };

    const heartbeat = setInterval(() => {
      if (!this.queue.heartbeat(this.workerId, job.id)) {
        // The lease lapsed and someone else may already own this job.
        this.runningJobs.abort(job.id);
      }
    }, this.config.heartbeatIntervalMs);

    try {
      await handler.handle(job.payload, ctx);
      this.queue.completeJob(job.id, this.workerId);
    } catch (err) {
      if (err instanceof JobCancelledError) {
        killSignal = err.killSignal;
        if (this.stopping) {
          this.queue.releaseJob(job.id, this.workerId);
        } else {
          this.queue.markCancelled(job.id, this.workerId, err.killSignal);
        }
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.queue.failJob(job.id, this.workerId, message);
      }
    } finally {
      clearInterval(heartbeat);
      this.currentJobId = null;
      this.runningJobs.finish(job.id, killSignal);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createWorker(deps: WorkerDeps): Worker {
  return new Worker(deps);
}
