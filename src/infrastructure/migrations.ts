// ============================================================================
// SmartDialer — Migration Runner
// ============================================================================
// Simple, linear migration runner using node:sqlite. Each migration is a .sql
// file with a numeric prefix. Migrations are applied in order and tracked in
// the schema_migrations table.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Database } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMigrations(db: Database): void {
  // Ensure schema_migrations table exists (bootstrap)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Find migrations directory - handle both ts-node and compiled scenarios
  const possibleDirs = [
    path.join(__dirname, 'migrations'),
    path.join(path.dirname(__dirname), 'infrastructure', 'migrations'),
    path.resolve('src/infrastructure/migrations'),
  ];

  let migrationsDir: string | null = null;
  for (const dir of possibleDirs) {
    if (fs.existsSync(dir)) {
      migrationsDir = dir;
      break;
    }
  }

  if (!migrationsDir) {
    console.warn('[migrations] No migrations directory found, skipping');
    return;
  }

  // Find all migration .sql files
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Get already-applied versions
  const applied = new Set<number>();
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  for (const row of rows) {
    applied.add(row.version);
  }

  // Apply pending migrations in order
  for (const file of migrationFiles) {
    const match = file.match(/^(\d+)_/);
    if (!match?.[1]) continue;

    const version = parseInt(match[1], 10);
    if (applied.has(version)) continue;

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log(`[migrations] Applying migration ${file}...`);

    // Apply in a transaction
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, file);
      db.exec('COMMIT');
      console.log(`[migrations] Applied migration ${file}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Failed to apply migration ${file}: ${err}`);
    }
  }
}

/**
 * Apply the schema SQL directly (for tests using in-memory databases).
 * Reads the SQL file and executes it, bypassing the migration tracking.
 */
export function applySchemaForTesting(db: Database): void {
  const possiblePaths = [
    path.resolve('src/infrastructure/migrations/001_initial_schema.sql'),
    path.join(__dirname, 'migrations', '001_initial_schema.sql'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const sql = fs.readFileSync(p, 'utf-8');
      db.exec(sql);
      return;
    }
  }

  throw new Error('Could not find schema SQL file for testing');
}
