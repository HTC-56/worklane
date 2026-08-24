import Database from "better-sqlite3";
import { Queue } from "./queue.js";
import { initializeSchema, migrate } from "./schema.js";
import type { CancelDispatcher, Config } from "../types.js";

/** Opens (or creates) the SQLite file and brings its schema up to date. */
export function createDatabase(path: string): Database.Database {
  const db = new Database(path);
  initializeSchema(db);
  migrate(db);
  return db;
}

export function createQueue(
  db: Database.Database,
  config: Config,
  dispatcher?: CancelDispatcher,
): Queue {
  return new Queue(db, config, dispatcher);
}

export { Queue } from "./queue.js";
export { initializeSchema, migrate, schemaVersion, SCHEMA_VERSION } from "./schema.js";
