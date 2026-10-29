// SQLite data layer. We use better-sqlite3 (synchronous, no callback/promise
// ceremony, ideal for this scale). createDb() opens a connection and ensures
// the schema exists, so tests can open an in-memory database and get a clean
// slate every run.
import Database from 'better-sqlite3';

export type DB = Database.Database;

export function createDb(path: string): DB {
  const db = new Database(path);
  // WAL mode: better read/write concurrency. foreign_keys: enforce relations.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS polls (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      question   TEXT NOT NULL,
      creator_id INTEGER NOT NULL REFERENCES users(id),
      closed     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS options (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      text    TEXT NOT NULL
    );

    -- One row per (poll, user): the UNIQUE constraint is what makes
    -- double-voting impossible at the database level, not just in app code.
    CREATE TABLE IF NOT EXISTS votes (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id   INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      option_id INTEGER NOT NULL REFERENCES options(id) ON DELETE CASCADE,
      user_id   INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (poll_id, user_id)
    );
  `);

  return db;
}
