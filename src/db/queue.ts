import type Database from "better-sqlite3";
import {
  ACTIVE_STATES,
  CLAIMABLE_STATES,
  type CancelDispatcher,
  type CancelResult,
  type Config,
  type EnqueueInput,
  EnqueueInputSchema,
  type Job,
  type JobState,
  type KillSignal,
  type QueueStats,
  type TypeStat,
  type WorkerRecord,
} from "../types.js";
import { DuplicateJobError, UnknownParentError } from "../errors.js";
import { jobEvent, type JobEventKind, type JobEventSink } from "../events.js";

interface JobRow {
  id: number;
  type: string;
  payload: string;
  priority: number;
  dedupe_key: string | null;
  state: string;
  attempts: number;
  max_attempts: number;
  parent_id: number | null;
  run_after: number | null;
  lease_until: number | null;
  worker_id: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  last_error: string | null;
  error_trail: string;
  progress_done: number | null;
  progress_total: number | null;
  progress_note: string | null;
  stdout_tail: string | null;
  stderr_tail: string | null;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    priority: row.priority,
    dedupeKey: row.dedupe_key,
    state: row.state as JobState,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    parentId: row.parent_id,
    runAfter: row.run_after,
    leaseUntil: row.lease_until,
    workerId: row.worker_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastError: row.last_error,
    errorTrail: JSON.parse(row.error_trail) as string[],
    progressDone: row.progress_done,
    progressTotal: row.progress_total,
    progressNote: row.progress_note,
    stdoutTail: row.stdout_tail,
    stderrTail: row.stderr_tail,
  };
}

const ACTIVE_LIST = ACTIVE_STATES.map((s) => `'${s}'`).join(", ");
const CLAIMABLE_LIST = CLAIMABLE_STATES.map((s) => `'${s}'`).join(", ");

const STATE_TO_STAT: Record<JobState, keyof QueueStats> = {
  PENDING: "pending",
  CLAIMED: "claimed",
  RUNNING: "running",
  FAILED: "failed",
  SUCCEEDED: "succeeded",
  DEAD_LETTER: "deadLetter",
  CANCELLED: "cancelled",
};

/**
 * Every state transition in worklane goes through this class. Delivery is
 * at-least-once: a job whose lease lapses becomes claimable again even if the
 * original worker is still alive somewhere.
 */
export class Queue {
  private readonly db: Database.Database;
  private readonly config: Config;
  private dispatcher: CancelDispatcher | null = null;
  private sink: JobEventSink | null = null;

  constructor(db: Database.Database, config: Config, dispatcher?: CancelDispatcher) {
    this.db = db;
    this.config = config;
    this.dispatcher = dispatcher ?? null;
  }

  /** The underlying handle, for the few callers that need schema-level reads. */
  get database(): Database.Database {
    return this.db;
  }

  /** Lets a worker pool register itself after construction. */
  setCancelDispatcher(dispatcher: CancelDispatcher | null): void {
    this.dispatcher = dispatcher;
  }

  /**
   * Where transitions go. Without a sink the queue is silent, which is what
   * every unit test that predates the ops surface expects.
   */
  setEventSink(sink: JobEventSink | null): void {
    this.sink = sink;
  }

  enqueue(input: EnqueueInput): Job {
    const parsed = EnqueueInputSchema.parse(input);
    const now = Date.now();

    if (parsed.dedupeKey !== undefined) {
      const existing = this.db
        .prepare(
          `SELECT id FROM jobs WHERE dedupe_key = ? AND state IN (${ACTIVE_LIST})`,
        )
        .get(parsed.dedupeKey) as { id: number } | undefined;
      if (existing) {
        throw new DuplicateJobError(parsed.dedupeKey, existing.id);
      }
    }

    // A child may be enqueued against a parent in any state; it simply stays
    // unclaimable until that parent succeeds.
    if (parsed.parentId !== undefined) {
      const parent = this.db
        .prepare("SELECT id FROM jobs WHERE id = ?")
        .get(parsed.parentId) as { id: number } | undefined;
      if (!parent) throw new UnknownParentError(parsed.parentId);
    }

    const result = this.db
      .prepare(
        `INSERT INTO jobs
           (type, payload, priority, dedupe_key, max_attempts, parent_id, run_after, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.type,
        JSON.stringify(parsed.payload),
        parsed.priority,
        parsed.dedupeKey ?? null,
        parsed.maxAttempts ?? this.config.defaultMaxAttempts,
        parsed.parentId ?? null,
        parsed.runAfter ?? null,
        now,
        now,
      );

    const job = this.getById(Number(result.lastInsertRowid));
    if (!job) throw new Error("enqueue failed to read the job back");
    this.publish("enqueued", job);
    return job;
  }

  getById(id: number): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
      | JobRow
      | undefined;
    return row ? rowToJob(row) : null;
  }

  /**
   * Atomically takes the highest-priority claimable job and puts it under a
   * lease. A job with a parent waits until that parent has SUCCEEDED.
   */
  claimNext(workerId: string): Job | null {
    const claim = this.db.transaction((now: number): Job | null => {
      const row = this.db
        .prepare(
          `SELECT * FROM jobs j
            WHERE j.state IN (${CLAIMABLE_LIST})
              AND (j.run_after IS NULL OR j.run_after <= ?)
              AND (j.parent_id IS NULL OR EXISTS (
                    SELECT 1 FROM jobs p WHERE p.id = j.parent_id AND p.state = 'SUCCEEDED'))
            ORDER BY j.priority DESC, j.created_at, j.id
            LIMIT 1`,
        )
        .get(now) as JobRow | undefined;

      if (!row) return null;

      const leaseUntil = now + this.config.leaseDurationMs;
      const updated = this.db
        .prepare(
          `UPDATE jobs
              SET state = 'CLAIMED', lease_until = ?, worker_id = ?, updated_at = ?, run_after = NULL
            WHERE id = ? AND state = ?`,
        )
        .run(leaseUntil, workerId, now, row.id, row.state);

      if (updated.changes === 0) return null;

      this.db
        .prepare(
          "UPDATE workers SET claimed_job_id = ?, last_heartbeat = ? WHERE id = ?",
        )
        .run(row.id, now, workerId);

      return this.getById(row.id);
    });

    const claimed = claim(Date.now());
    if (claimed) this.publish("claimed", claimed);
    return claimed;
  }

  /** Moves a leased job into RUNNING. Returns null if the lease was lost. */
  startJob(jobId: number, workerId: string): Job | null {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE jobs
            SET state = 'RUNNING', started_at = ?, updated_at = ?
          WHERE id = ? AND worker_id = ? AND state = 'CLAIMED'`,
      )
      .run(now, now, jobId, workerId);
    if (result.changes === 0) return null;
    return this.publishById("started", jobId);
  }

  /** Extends the lease. False means the lease was lost and work should stop. */
  heartbeat(workerId: string, jobId: number): boolean {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE jobs
            SET lease_until = ?, updated_at = ?
          WHERE id = ? AND worker_id = ? AND state IN ('CLAIMED', 'RUNNING')`,
      )
      .run(now + this.config.leaseDurationMs, now, jobId, workerId);

    if (result.changes > 0) {
      this.db
        .prepare("UPDATE workers SET last_heartbeat = ? WHERE id = ?")
        .run(now, workerId);
    }
    return result.changes > 0;
  }

  completeJob(jobId: number, workerId: string): Job | null {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE jobs
            SET state = 'SUCCEEDED', finished_at = ?, updated_at = ?,
                lease_until = NULL, worker_id = NULL, last_error = NULL
          WHERE id = ? AND worker_id = ? AND state = 'RUNNING'`,
      )
      .run(now, now, jobId, workerId);
    if (result.changes === 0) return null;
    this.clearWorkerClaim(workerId);
    return this.publishById("succeeded", jobId);
  }

  /**
   * Records a failed attempt. With attempts left the job goes to FAILED with a
   * backoff deadline; otherwise it dead-letters with the whole trail intact.
   */
  failJob(jobId: number, workerId: string, error: string): Job | null {
    const job = this.getById(jobId);
    if (!job || job.workerId !== workerId || job.state !== "RUNNING") return null;

    const now = Date.now();
    const attempts = job.attempts + 1;
    const trail = JSON.stringify([...job.errorTrail, error]);

    if (attempts >= job.maxAttempts) {
      this.db
        .prepare(
          `UPDATE jobs
              SET state = 'DEAD_LETTER', attempts = ?, last_error = ?, error_trail = ?,
                  updated_at = ?, finished_at = ?, lease_until = NULL, worker_id = NULL,
                  run_after = NULL
            WHERE id = ?`,
        )
        .run(attempts, error, trail, now, now, jobId);
      this._cascadeDeadLetterChildren(jobId);
    } else {
      this.db
        .prepare(
          `UPDATE jobs
              SET state = 'FAILED', attempts = ?, last_error = ?, error_trail = ?,
                  updated_at = ?, run_after = ?, lease_until = NULL, worker_id = NULL
            WHERE id = ?`,
        )
        .run(attempts, error, trail, now, now + this.backoffMs(attempts), jobId);
    }

    this.clearWorkerClaim(workerId);
    return this.publishById(
      attempts >= job.maxAttempts ? "dead_letter" : "failed",
      jobId,
    );
  }

  /** Fails a job outright, skipping the retry ladder (e.g. no such handler). */
  deadLetterJob(jobId: number, workerId: string, error: string): Job | null {
    const job = this.getById(jobId);
    if (!job || job.workerId !== workerId || job.state !== "RUNNING") return null;

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE jobs
            SET state = 'DEAD_LETTER', attempts = ?, last_error = ?, error_trail = ?,
                updated_at = ?, finished_at = ?, lease_until = NULL, worker_id = NULL,
                run_after = NULL
          WHERE id = ?`,
      )
      .run(
        job.attempts + 1,
        error,
        JSON.stringify([...job.errorTrail, error]),
        now,
        now,
        jobId,
      );

    this.clearWorkerClaim(workerId);
    this._cascadeDeadLetterChildren(jobId);
    return this.publishById("dead_letter", jobId);
  }

  /** Hands a job back untouched — used when a worker shuts down mid-job. */
  releaseJob(jobId: number, workerId: string): Job | null {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE jobs
            SET state = 'PENDING', lease_until = NULL, worker_id = NULL,
                started_at = NULL, updated_at = ?
          WHERE id = ? AND worker_id = ? AND state IN ('CLAIMED', 'RUNNING')`,
      )
      .run(now, jobId, workerId);
    if (result.changes === 0) return null;
    this.clearWorkerClaim(workerId);
    return this.publishById("released", jobId);
  }

  /** Records that a running job was killed, naming the signal that did it. */
  markCancelled(jobId: number, workerId: string, signal: KillSignal): Job | null {
    const job = this.getById(jobId);
    if (!job || job.workerId !== workerId) return null;

    const now = Date.now();
    const note = `cancelled by ${signal}`;
    this.db
      .prepare(
        `UPDATE jobs
            SET state = 'CANCELLED', last_error = ?, error_trail = ?, updated_at = ?,
                finished_at = ?, lease_until = NULL, worker_id = NULL, run_after = NULL
          WHERE id = ?`,
      )
      .run(note, JSON.stringify([...job.errorTrail, note]), now, now, jobId);

    this.clearWorkerClaim(workerId);
    this._cascadeCancelChildren(jobId);
    return this.publishById("cancelled", jobId);
  }

  /**
   * Cancels a job. Not-yet-running jobs flip straight to CANCELLED; a RUNNING
   * job is handed to the cancel dispatcher, which kills the child and reports
   * which signal ended it.
   */
  async cancelJob(jobId: number): Promise<CancelResult> {
    const job = this.getById(jobId);
    if (!job) return { jobId, signal: "NONE", wasRunning: false };

    if (job.state === "RUNNING") {
      if (!this.dispatcher) return { jobId, signal: "NONE", wasRunning: true };
      const signal = await this.dispatcher.cancel(jobId);
      return { jobId, signal, wasRunning: true };
    }

    if (job.state === "PENDING" || job.state === "CLAIMED" || job.state === "FAILED") {
      const now = Date.now();
      this.db
        .prepare(
          `UPDATE jobs
              SET state = 'CANCELLED', updated_at = ?, finished_at = ?,
                  lease_until = NULL, worker_id = NULL, run_after = NULL
            WHERE id = ?`,
        )
        .run(now, now, jobId);
      if (job.workerId) this.clearWorkerClaim(job.workerId);
      this._cascadeCancelChildren(jobId);
      this.publishById("cancelled", jobId);
    }

    return { jobId, signal: "NONE", wasRunning: false };
  }

  /** Brings a dead-lettered job back for another run, keeping its trail. */
  requeueDeadLetter(jobId: number): Job | null {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE jobs
            SET state = 'PENDING', attempts = 0, last_error = NULL, updated_at = ?,
                run_after = NULL, finished_at = NULL, started_at = NULL
          WHERE id = ? AND state = 'DEAD_LETTER'`,
      )
      .run(now, jobId);
    if (result.changes === 0) return null;
    return this.publishById("requeued", jobId);
  }

  updateProgress(
    jobId: number,
    workerId: string,
    done: number,
    total: number,
    note?: string,
  ): boolean {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE jobs
            SET progress_done = ?, progress_total = ?, progress_note = ?, updated_at = ?
          WHERE id = ? AND worker_id = ? AND state = 'RUNNING'`,
      )
      .run(done, total, note ?? null, now, jobId, workerId);
    if (result.changes > 0) this.publishById("progress", jobId);
    return result.changes > 0;
  }

  /** Stores the captured output tails of a running job. */
  recordOutput(
    jobId: number,
    workerId: string,
    stdout: string,
    stderr: string,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE jobs
            SET stdout_tail = ?, stderr_tail = ?, updated_at = ?
          WHERE id = ? AND worker_id = ? AND state = 'RUNNING'`,
      )
      .run(stdout, stderr, Date.now(), jobId, workerId);
    return result.changes > 0;
  }

  /**
   * Returns jobs whose lease has lapsed to the queue. This is what makes a
   * dead worker recoverable, and what makes delivery at-least-once.
   */
  releaseStaleLeases(): number {
    const now = Date.now();
    const reclaimed: number[] = [];
    const reclaim = this.db.transaction((): number => {
      const stale = this.db
        .prepare(
          `SELECT id, worker_id FROM jobs
            WHERE state IN ('CLAIMED', 'RUNNING')
              AND lease_until IS NOT NULL AND lease_until < ?`,
        )
        .all(now) as { id: number; worker_id: string | null }[];

      for (const row of stale) {
        this.db
          .prepare(
            `UPDATE jobs
                SET state = 'PENDING', lease_until = NULL, worker_id = NULL,
                    started_at = NULL, updated_at = ?
              WHERE id = ?`,
          )
          .run(now, row.id);
        if (row.worker_id) this.clearWorkerClaim(row.worker_id);
        reclaimed.push(row.id);
      }
      return stale.length;
    });

    const count = reclaim();
    for (const id of reclaimed) this.publishById("released", id);
    return count;
  }

  getStats(): QueueStats {
    const stats: QueueStats = {
      pending: 0,
      claimed: 0,
      running: 0,
      failed: 0,
      succeeded: 0,
      deadLetter: 0,
      cancelled: 0,
    };
    const rows = this.db
      .prepare("SELECT state, COUNT(*) AS count FROM jobs GROUP BY state")
      .all() as { state: JobState; count: number }[];

    for (const row of rows) {
      const key = STATE_TO_STAT[row.state];
      if (key) stats[key] = row.count;
    }
    return stats;
  }

  /**
   * Per-type counts plus throughput: how many of that type succeeded inside
   * `windowMs`, and how long a successful run takes on average. This is what
   * the dashboard's throughput panel and `/metrics` per-type series read.
   */
  byType(windowMs = this.config.throughputWindowMs): TypeStat[] {
    const since = Date.now() - windowMs;
    const rows = this.db
      .prepare(
        `SELECT type,
                SUM(state = 'PENDING') AS pending,
                SUM(state IN ('CLAIMED', 'RUNNING')) AS running,
                SUM(state = 'SUCCEEDED') AS succeeded,
                SUM(state = 'FAILED') AS failed,
                SUM(state = 'DEAD_LETTER') AS dead_letter,
                SUM(state = 'CANCELLED') AS cancelled,
                SUM(state = 'SUCCEEDED' AND finished_at >= ?) AS recent,
                AVG(CASE WHEN state = 'SUCCEEDED'
                          AND started_at IS NOT NULL
                          AND finished_at IS NOT NULL
                         THEN finished_at - started_at END) AS avg_ms
           FROM jobs
          GROUP BY type
          ORDER BY type`,
      )
      .all(since) as {
      type: string;
      pending: number;
      running: number;
      succeeded: number;
      failed: number;
      dead_letter: number;
      cancelled: number;
      recent: number;
      avg_ms: number | null;
    }[];

    return rows.map((r) => ({
      type: r.type,
      pending: r.pending,
      running: r.running,
      succeeded: r.succeeded,
      failed: r.failed,
      deadLetter: r.dead_letter,
      cancelled: r.cancelled,
      succeededRecently: r.recent,
      avgDurationMs: r.avg_ms === null ? null : Math.round(r.avg_ms),
    }));
  }

  listJobs(state?: JobState, limit = 100, offset = 0): Job[] {
    const rows = state
      ? (this.db
          .prepare(
            "SELECT * FROM jobs WHERE state = ? ORDER BY priority DESC, created_at, id LIMIT ? OFFSET ?",
          )
          .all(state, limit, offset) as JobRow[])
      : (this.db
          .prepare(
            "SELECT * FROM jobs ORDER BY priority DESC, created_at, id LIMIT ? OFFSET ?",
          )
          .all(limit, offset) as JobRow[]);
    return rows.map(rowToJob);
  }

  /** Direct children of a job. v1 is one level of fan-out — no DAGs. */
  listChildren(parentId: number): Job[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs WHERE parent_id = ? ORDER BY id")
      .all(parentId) as JobRow[];
    return rows.map(rowToJob);
  }

  registerWorker(workerId: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO workers (id, started_at, last_heartbeat, claimed_job_id)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at,
                                       last_heartbeat = excluded.last_heartbeat,
                                       claimed_job_id = NULL`,
      )
      .run(workerId, now, now);
  }

  /** Drops a worker and returns anything it still held to the queue. */
  unregisterWorker(workerId: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE jobs
            SET state = 'PENDING', lease_until = NULL, worker_id = NULL,
                started_at = NULL, updated_at = ?
          WHERE worker_id = ? AND state IN ('CLAIMED', 'RUNNING')`,
      )
      .run(now, workerId);
    this.db.prepare("DELETE FROM workers WHERE id = ?").run(workerId);
  }

  getWorkers(): WorkerRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM workers ORDER BY id")
      .all() as {
      id: string;
      started_at: number;
      last_heartbeat: number;
      claimed_job_id: number | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      lastHeartbeat: r.last_heartbeat,
      claimedJobId: r.claimed_job_id,
    }));
  }

  /** Exponential backoff with jitter, capped by config.maxBackoffMs. */
  private backoffMs(attempts: number): number {
    const raw = this.config.baseBackoffMs * 2 ** (attempts - 1);
    const capped = Math.min(raw, this.config.maxBackoffMs);
    const jitter = Math.random() * Math.min(capped, this.config.baseBackoffMs);
    return Math.floor(capped + jitter);
  }

  /**
   * When a job reaches DEAD_LETTER, every direct child that isn't already in a
   * terminal state also flips to DEAD_LETTER. Terminal states (SUCCEEDED,
   * DEAD_LETTER, CANCELLED) are left alone. One level only — no recursion.
   */
  private _cascadeDeadLetterChildren(parentId: number): void {
    const now = Date.now();
    const affected = this.childrenToCascade(parentId);
    if (affected.length === 0) return;
    this.db
      .prepare(
        `UPDATE jobs
            SET state = 'DEAD_LETTER', last_error = ?, error_trail = ?,
                updated_at = ?, finished_at = ?,
                lease_until = NULL, worker_id = NULL, run_after = NULL
          WHERE parent_id = ?
            AND state NOT IN ('SUCCEEDED', 'DEAD_LETTER', 'CANCELLED')`,
      )
      .run(
        `dead-lettered (parent ${parentId})`,
        JSON.stringify([`dead-lettered (parent ${parentId})`]),
        now,
        now,
        parentId,
      );
    for (const id of affected) this.publishById("dead_letter", id);
  }

  /**
   * When a job is CANCELLED, every direct child that isn't already terminal
   * also flips to CANCELLED. Terminal states (SUCCEEDED, DEAD_LETTER,
   * CANCELLED) are left alone. One level only — no recursion.
   */
  private _cascadeCancelChildren(parentId: number): void {
    const now = Date.now();
    const affected = this.childrenToCascade(parentId);
    if (affected.length === 0) return;
    this.db
      .prepare(
        `UPDATE jobs
            SET state = 'CANCELLED', last_error = ?, error_trail = ?,
                updated_at = ?, finished_at = ?,
                lease_until = NULL, worker_id = NULL, run_after = NULL
          WHERE parent_id = ?
            AND state NOT IN ('SUCCEEDED', 'DEAD_LETTER', 'CANCELLED')`,
      )
      .run(
        `cancelled (parent ${parentId})`,
        JSON.stringify([`cancelled (parent ${parentId})`]),
        now,
        now,
        parentId,
      );
    for (const id of affected) this.publishById("cancelled", id);
  }

  /** Ids of the direct children a cascade is about to move. */
  private childrenToCascade(parentId: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM jobs
          WHERE parent_id = ?
            AND state NOT IN ('SUCCEEDED', 'DEAD_LETTER', 'CANCELLED')`,
      )
      .all(parentId) as { id: number }[];
    return rows.map((r) => r.id);
  }

  private clearWorkerClaim(workerId: string): void {
    this.db
      .prepare("UPDATE workers SET claimed_job_id = NULL WHERE id = ?")
      .run(workerId);
  }

  /** Tells the sink about a transition. Silent when no sink is attached. */
  private publish(kind: JobEventKind, job: Job): void {
    if (!this.sink) return;
    this.sink.publish(jobEvent(kind, job, Date.now()));
  }

  /** Re-reads a job, announces its transition, and returns it. */
  private publishById(kind: JobEventKind, jobId: number): Job | null {
    const job = this.getById(jobId);
    if (job) this.publish(kind, job);
    return job;
  }
}
