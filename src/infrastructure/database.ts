// ============================================================================
// SmartDialer — Database Infrastructure
// ============================================================================
// Uses Node.js 24's built-in node:sqlite module (Release Candidate status).
// Zero external dependencies for database access.
//
// Design decisions:
// - WAL mode for concurrent readers + single writer
// - Busy timeout prevents immediate SQLITE_BUSY errors
// - Foreign keys enforced for referential integrity
// - Synchronous API (DatabaseSync) — natural fit for transactional operations
//
// PostgreSQL migration path:
// - All SQL uses standard SQL compatible with PostgreSQL
// - Replace node:sqlite with pg driver
// - Transaction semantics are identical
// ============================================================================

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { SmartDialerConfig } from '../config.js';

// Use createRequire to load node:sqlite
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

export type Database = any;

export function createInMemoryDatabase(): Database {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');

  const schemaPath = path.resolve('src/infrastructure/migrations/001_initial_schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(sql);
  return db;
}

export interface DatabaseConnection {
  db: Database;
  close(): void;
}

export function createDatabase(config: SmartDialerConfig): DatabaseConnection {
  const dbPath = config.database.path === ':memory:'
    ? ':memory:'
    : path.resolve(config.database.path);

  const db = new DatabaseSync(dbPath);

  // --- Performance & Safety Pragmas ---
  if (config.database.walMode) {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec(`PRAGMA busy_timeout = ${config.database.busyTimeout}`);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA journal_size_limit = 67108864');  // 64MB WAL limit
  db.exec('PRAGMA cache_size = -64000');             // 64MB cache

  return {
    db,
    close() {
      try {
        db.close();
      } catch {
        // Already closed
      }
    },
  };
}

/**
 * Run a function inside a database transaction.
 * Automatically commits on success, rolls back on error.
 *
 * Uses BEGIN IMMEDIATE to acquire a write lock upfront,
 * preventing upgrade deadlocks during concurrent reservations.
 */
export function withTransaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Rollback may fail if transaction already rolled back
    }
    throw err;
  }
}
