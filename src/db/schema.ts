import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 1;

/**
 * Creates the tables and indexes. Safe to call on an existing database.
 * WAL is the whole durability story: one file, one box, N workers.
 */
export function initializeSchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      priority INTEGER NOT NULL DEFAULT 0,
      dedupe_key TEXT,
      state TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      parent_id INTEGER,
      run_after INTEGER,
      lease_until INTEGER,
      worker_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      last_error TEXT,
      error_trail TEXT NOT NULL DEFAULT '[]',
      progress_done INTEGER,
      progress_total INTEGER,
      progress_note TEXT,
      stdout_tail TEXT,
      stderr_tail TEXT,
      FOREIGN KEY (parent_id) REFERENCES jobs(id) ON DELETE SET NULL
    );

    /* A dedupe key is only reserved while the job is still in flight, so the
       same key may be reused once the previous job reaches a terminal state. */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe_active
      ON jobs(dedupe_key)
      WHERE dedupe_key IS NOT NULL
        AND state IN ('PENDING', 'CLAIMED', 'RUNNING', 'FAILED');

    CREATE INDEX IF NOT EXISTS idx_jobs_claim
      ON jobs(state, priority DESC, created_at);

    CREATE INDEX IF NOT EXISTS idx_jobs_parent
      ON jobs(parent_id);

    CREATE INDEX IF NOT EXISTS idx_jobs_lease
      ON jobs(lease_until) WHERE lease_until IS NOT NULL;

    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      last_heartbeat INTEGER NOT NULL,
      claimed_job_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.prepare(
    "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)",
  ).run(String(SCHEMA_VERSION));
}

/** Reads the recorded schema version, or 0 for a database with no meta row. */
export function schemaVersion(db: Database.Database): number {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  return row ? Number.parseInt(row.value, 10) : 0;
}

/**
 * Applies pending migrations. v1 is the first shipped schema, so there is
 * nothing to move yet; later versions add their steps here in order.
 */
export function migrate(db: Database.Database): void {
  const current = schemaVersion(db);
  if (current >= SCHEMA_VERSION) return;

  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('schema_version', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(SCHEMA_VERSION));
}
