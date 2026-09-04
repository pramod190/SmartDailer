// ============================================================================
// SmartDialer — Borrower Repository
// ============================================================================
// Borrower selection is deterministic and protected against double-allocation.
// Selection priority: eligible → campaign match → nextEligibleAt <= now →
// highest priority → oldest lastAttemptAt → stable ID tie-breaker.
// ============================================================================

import { v4 as uuid } from 'uuid';
import type { Database } from '../../infrastructure/database.js';
import type { Borrower, BorrowerStatus } from './Borrower.js';
import { logger } from '../../common/logger.js';

export class BorrowerRepository {
  constructor(private readonly db: Database) {}

  create(campaignId: string, phoneNumber: string, priority: number = 0): Borrower {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO borrowers (id, campaign_id, phone_number, status, priority, version, created_at, updated_at)
      VALUES (?, ?, ?, 'eligible', ?, 1, ?, ?)
    `).run(id, campaignId, phoneNumber, priority, now, now);
    return this.findById(id)!;
  }

  findById(id: string): Borrower | null {
    const row = this.db.prepare('SELECT * FROM borrowers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  /**
   * Select the next eligible borrower using deterministic priority ordering.
   *
   * Priority: highest priority → oldest lastAttemptAt → stable ID tie-breaker
   * Only returns borrowers where nextEligibleAt is null or <= now.
   *
   * Returns null if no eligible borrower exists.
   */
  selectNextEligible(campaignId: string): Borrower | null {
    const row = this.db.prepare(`
      SELECT * FROM borrowers
      WHERE campaign_id = ?
        AND status = 'eligible'
        AND (next_eligible_at IS NULL OR next_eligible_at <= datetime('now'))
      ORDER BY priority DESC,
               CASE WHEN last_attempt_at IS NULL THEN 0 ELSE 1 END ASC,
               last_attempt_at ASC,
               id ASC
      LIMIT 1
    `).get(campaignId) as Record<string, unknown> | undefined;

    return row ? this.mapRow(row) : null;
  }

  /**
   * Atomically allocate a borrower using optimistic locking.
   * Prevents two workers from allocating the same borrower.
   */
  allocate(borrowerId: string, expectedVersion: number): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE borrowers
      SET status = 'allocated',
          version = version + 1,
          attempt_count = attempt_count + 1,
          last_attempt_at = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'eligible'
        AND version = ?
    `).run(now, now, borrowerId, expectedVersion);

    const success = result.changes === 1;
    logger.debug(
      success ? 'Borrower allocated' : 'Borrower allocation failed (conflict)',
      { borrowerId, component: 'BorrowerRepository' }
    );
    return success;
  }

  /**
   * Release borrower back to eligible (e.g., after call failure).
   * Sets nextEligibleAt for retry backoff.
   */
  release(borrowerId: string, nextEligibleAt?: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE borrowers
      SET status = 'eligible',
          version = version + 1,
          next_eligible_at = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'allocated'
    `).run(nextEligibleAt ?? null, now, borrowerId);
    return result.changes === 1;
  }

  /**
   * Mark borrower as completed (call succeeded).
   */
  complete(borrowerId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE borrowers
      SET status = 'completed',
          version = version + 1,
          updated_at = ?
      WHERE id = ?
    `).run(now, borrowerId);
    return result.changes === 1;
  }

  /**
   * Mark borrower as exhausted (max retries reached).
   */
  exhaust(borrowerId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE borrowers
      SET status = 'exhausted',
          version = version + 1,
          updated_at = ?
      WHERE id = ?
    `).run(now, borrowerId);
    return result.changes === 1;
  }

  countByStatus(campaignId: string, status: BorrowerStatus): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM borrowers WHERE campaign_id = ? AND status = ?'
    ).get(campaignId, status) as { count: number };
    return row.count;
  }

  findByCampaign(campaignId: string): Borrower[] {
    const rows = this.db.prepare(
      'SELECT * FROM borrowers WHERE campaign_id = ?'
    ).all(campaignId) as Record<string, unknown>[];
    return rows.map(r => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): Borrower {
    return {
      id: row['id'] as string,
      campaignId: row['campaign_id'] as string,
      phoneNumber: row['phone_number'] as string,
      status: row['status'] as BorrowerStatus,
      priority: row['priority'] as number,
      attemptCount: row['attempt_count'] as number,
      lastAttemptAt: row['last_attempt_at'] as string | null,
      nextEligibleAt: row['next_eligible_at'] as string | null,
      version: row['version'] as number,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }
}
