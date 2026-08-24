import { z } from "zod";

/** Every state a job can be in. `FAILED` means "attempt failed, retry scheduled". */
export const JobStateSchema = z.enum([
  "PENDING",
  "CLAIMED",
  "RUNNING",
  "FAILED",
  "SUCCEEDED",
  "DEAD_LETTER",
  "CANCELLED",
]);
export type JobState = z.infer<typeof JobStateSchema>;

/** States from which a worker may pick a job up. */
export const CLAIMABLE_STATES = ["PENDING", "FAILED"] as const;

/** States that hold a dedupe key hostage — re-enqueuing the same key is rejected. */
export const ACTIVE_STATES = ["PENDING", "CLAIMED", "RUNNING", "FAILED"] as const;

export type KillSignal = "SIGTERM" | "SIGKILL" | "NONE";

export interface Job {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  dedupeKey: string | null;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  parentId: number | null;
  runAfter: number | null;
  leaseUntil: number | null;
  workerId: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
  errorTrail: string[];
  progressDone: number | null;
  progressTotal: number | null;
  progressNote: string | null;
  stdoutTail: string | null;
  stderrTail: string | null;
}

export const EnqueueInputSchema = z.object({
  type: z.string().min(1).max(64),
  payload: z.record(z.unknown()).default({}),
  priority: z.number().int().default(0),
  dedupeKey: z.string().min(1).max(128).optional(),
  maxAttempts: z.number().int().positive().max(10).optional(),
  parentId: z.number().int().positive().optional(),
  runAfter: z.number().int().nonnegative().optional(),
});
export type EnqueueInput = z.input<typeof EnqueueInputSchema>;

export interface WorkerRecord {
  id: string;
  startedAt: number;
  lastHeartbeat: number;
  claimedJobId: number | null;
}

export const ConfigSchema = z.object({
  dbPath: z.string().min(1).default("./worklane.sqlite"),
  leaseDurationMs: z.number().int().positive().default(30_000),
  heartbeatIntervalMs: z.number().int().positive().default(5_000),
  pollIntervalMs: z.number().int().positive().default(100),
  workerCount: z.number().int().positive().default(4),
  defaultMaxAttempts: z.number().int().positive().max(10).default(3),
  baseBackoffMs: z.number().int().positive().default(1_000),
  maxBackoffMs: z.number().int().positive().default(60_000),
  killGraceMs: z.number().int().positive().default(5_000),
  /** 0 asks the OS for any free port — what the tests bind to. */
  httpPort: z.number().int().nonnegative().max(65_535).default(8080),
  httpHost: z.string().default("127.0.0.1"),
  bearerToken: z.string().min(16).optional(),
  /** JSONL audit trail. Empty string turns the ledger off. */
  ledgerPath: z.string().default("./ledger.jsonl"),
  /** How many recent events `/events` and the dashboard can replay. */
  eventBufferSize: z.number().int().positive().max(10_000).default(200),
  /** SSE keep-alive comment interval, so proxies do not close idle streams. */
  sseHeartbeatMs: z.number().int().positive().default(15_000),
  /** Window `/stats` measures per-type throughput over. */
  throughputWindowMs: z.number().int().positive().default(300_000),
});
export type Config = z.infer<typeof ConfigSchema>;

export function defaultConfig(overrides: Partial<Config> = {}): Config {
  return ConfigSchema.parse({ ...overrides });
}

export const ProgressUpdateSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  note: z.string().max(200).optional(),
});
export type ProgressUpdate = z.infer<typeof ProgressUpdateSchema>;

/**
 * What a handler is given while it runs. `signal` aborts when the job is
 * cancelled or its worker shuts down; a well-behaved handler stops promptly.
 */
export interface HandlerContext {
  jobId: number;
  workerId: string;
  signal: AbortSignal;
  progress(update: ProgressUpdate): void;
  /** Records the captured stdout/stderr tails against the job. */
  output(stdout: string, stderr: string): void;
}

/** The extension point: register one of these per job type. */
export interface Handler {
  type: string;
  handle(payload: Record<string, unknown>, ctx: HandlerContext): Promise<void>;
}

export interface CancelResult {
  jobId: number;
  signal: KillSignal;
  wasRunning: boolean;
}

/** Per-job-type counts, plus how many succeeded inside the throughput window. */
export interface TypeStat {
  type: string;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  deadLetter: number;
  cancelled: number;
  succeededRecently: number;
  avgDurationMs: number | null;
}

export interface QueueStats {
  pending: number;
  claimed: number;
  running: number;
  failed: number;
  succeeded: number;
  deadLetter: number;
  cancelled: number;
}

/**
 * How the queue reaches a job that is running right now. The worker pool
 * implements this; without one, cancelling a RUNNING job is a no-op.
 */
export interface CancelDispatcher {
  cancel(jobId: number): Promise<KillSignal>;
}
