// ============================================================================
// Test Helper — Creates an in-memory database with full schema
// ============================================================================

import { createRequire } from 'node:module';
import fs from 'fs';
import path from 'path';
import type { Database } from '../../src/infrastructure/database.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

export function createTestDatabase(): Database {
  const db = new DatabaseSync(':memory:');

  // Apply same pragmas as production
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  // Apply schema
  const schemaPath = path.resolve('src/infrastructure/migrations/001_initial_schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(sql);

  return db;
}

/**
 * Create a test database backed by a file (needed for concurrency tests
 * where multiple connections access the same database).
 */
export function createTestDatabaseFile(filePath: string): Database {
  // Remove existing file
  try { fs.unlinkSync(filePath); } catch { /* noop */ }
  try { fs.unlinkSync(filePath + '-wal'); } catch { /* noop */ }
  try { fs.unlinkSync(filePath + '-shm'); } catch { /* noop */ }

  const db = new DatabaseSync(filePath);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  const schemaPath = path.resolve('src/infrastructure/migrations/001_initial_schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(sql);

  return db;
}
