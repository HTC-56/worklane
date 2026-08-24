import type { Job, JobState } from "./types.js";

/** Every transition worth telling the outside world about. */
export type JobEventKind =
  | "enqueued"
  | "claimed"
  | "started"
  | "progress"
  | "succeeded"
  | "failed"
  | "dead_letter"
  | "cancelled"
  | "requeued"
  | "released";

/**
 * One line of the story of a job. The same record is what `/events` streams,
 * what the JSONL ledger appends, and what the dashboard renders — there is no
 * second event shape anywhere in worklane.
 */
export interface JobEvent {
  ts: number;
  kind: JobEventKind;
  jobId: number;
  type: string;
  state: JobState;
  attempts: number;
  error: string | null;
  progress: { done: number; total: number; note: string | null } | null;
}

/** Anything that wants to hear about transitions. The Queue holds one. */
export interface JobEventSink {
  publish(event: JobEvent): void;
}

export function jobEvent(kind: JobEventKind, job: Job, ts: number): JobEvent {
  return {
    ts,
    kind,
    jobId: job.id,
    type: job.type,
    state: job.state,
    attempts: job.attempts,
    error: job.lastError,
    progress:
      job.progressTotal === null
        ? null
        : {
            done: job.progressDone ?? 0,
            total: job.progressTotal,
            note: job.progressNote,
          },
  };
}

export type EventListener = (event: JobEvent) => void;

/**
 * A tiny in-process fan-out with a ring buffer of recent events. SSE clients
 * subscribe; the ledger subscribes; a listener that throws is isolated so one
 * broken client cannot take a transition down with it.
 */
export class EventBus implements JobEventSink {
  private readonly listeners = new Set<EventListener>();
  private readonly buffer: JobEvent[] = [];
  private readonly bufferSize: number;

  constructor(bufferSize = 200) {
    this.bufferSize = Math.max(1, bufferSize);
  }

  publish(event: JobEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.splice(0, this.buffer.length - this.bufferSize);
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A subscriber's failure is its own problem, never the queue's.
      }
    }
  }

  /** Returns the unsubscribe function; callers must actually call it. */
  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The most recent events, oldest first, capped at `limit`. */
  recent(limit = 50): JobEvent[] {
    if (limit >= this.buffer.length) return [...this.buffer];
    return this.buffer.slice(this.buffer.length - limit);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}
