// ============================================================================
// SmartDialer — Call Repository
// ============================================================================

import { v4 as uuid } from 'uuid';
import type { Database } from '../../infrastructure/database.js';
import { CallStateMachine, type Call, type CallState } from './CallState.js';
import { logger } from '../../common/logger.js';

export class CallRepository {
  constructor(private readonly db: Database) {}

  create(params: {
    campaignId: string;
    agentId: string;
    borrowerId: string;
    attemptNumber?: number;
  }): Call {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO calls (id, campaign_id, agent_id, borrower_id, state, attempt_number, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'QUEUED', ?, ?, ?)
    `).run(id, params.campaignId, params.agentId, params.borrowerId, params.attemptNumber ?? 1, now, now);

    return this.findById(id)!;
  }

  findById(id: string): Call | null {
    const row = this.db.prepare('SELECT * FROM calls WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByProviderCallId(providerCallId: string): Call | null {
    const row = this.db.prepare(
      'SELECT * FROM calls WHERE provider_call_id = ?'
    ).get(providerCallId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findActiveByCampaign(campaignId: string): Call[] {
    const rows = this.db.prepare(`
      SELECT * FROM calls WHERE campaign_id = ?
        AND state IN ('QUEUED', 'RESERVED', 'INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED')
    `).all(campaignId) as Record<string, unknown>[];
    return rows.map(r => this.mapRow(r));
  }

  findActiveByBorrower(borrowerId: string): Call[] {
    const rows = this.db.prepare(`
      SELECT * FROM calls WHERE borrower_id = ?
        AND state IN ('QUEUED', 'RESERVED', 'INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED')
    `).all(borrowerId) as Record<string, unknown>[];
    return rows.map(r => this.mapRow(r));
  }

  countByState(campaignId: string, state: CallState): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM calls WHERE campaign_id = ? AND state = ?'
    ).get(campaignId, state) as { count: number };
    return row.count;
  }

  countActiveByStates(campaignId: string): Record<string, number> {
    const states = ['QUEUED', 'RESERVED', 'INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED'];
    const result: Record<string, number> = {};
    for (const state of states) {
      result[state] = this.countByState(campaignId, state as CallState);
    }
    return result;
  }

  /**
   * Transition call state with optimistic locking and state machine validation.
   */
  transitionState(
    callId: string,
    targetState: CallState,
    expectedVersion: number,
    extra?: {
      providerCallId?: string;
      providerName?: string;
      failureReason?: string;
      lastProviderSequence?: number;
    }
  ): boolean {
    const call = this.findById(callId);
    if (!call) return false;

    // State machine validation
    CallStateMachine.validateTransition(call.state, targetState);

    const now = new Date().toISOString();

    // Determine which timestamp to set
    let timestampCol = '';
    switch (targetState) {
      case 'INITIATED': timestampCol = 'initiated_at'; break;
      case 'RINGING': timestampCol = 'ringing_at'; break;
      case 'ANSWERED': timestampCol = 'answered_at'; break;
      case 'CONNECTED': timestampCol = 'connected_at'; break;
      case 'COMPLETED':
      case 'FAILED':
      case 'CANCELLED': timestampCol = 'completed_at'; break;
    }

    // Build the update
    const setClauses = [
      'state = ?',
      'version = version + 1',
      'updated_at = ?',
    ];
    const params: unknown[] = [targetState, now];

    if (timestampCol) {
      setClauses.push(`${timestampCol} = ?`);
      params.push(now);
    }
    if (extra?.providerCallId) {
      setClauses.push('provider_call_id = ?');
      params.push(extra.providerCallId);
    }
    if (extra?.providerName) {
      setClauses.push('provider_name = ?');
      params.push(extra.providerName);
    }
    if (extra?.failureReason) {
      setClauses.push('failure_reason = ?');
      params.push(extra.failureReason);
    }
    if (extra?.lastProviderSequence !== undefined) {
      setClauses.push('last_provider_sequence = ?');
      params.push(extra.lastProviderSequence);
    }

    params.push(callId, expectedVersion);

    const sql = `UPDATE calls SET ${setClauses.join(', ')} WHERE id = ? AND version = ?`;
    const result = this.db.prepare(sql).run(...params);

    return result.changes === 1;
  }

  /**
   * Get recent completed/failed calls for answer rate calculation.
   */
  getRecentCallStats(campaignId: string, limit: number): { answered: number; total: number } {
    const rows = this.db.prepare(`
      SELECT state FROM calls
      WHERE campaign_id = ?
        AND state IN ('COMPLETED', 'FAILED')
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(campaignId, limit) as Array<{ state: string }>;

    const answered = rows.filter(r => r.state === 'COMPLETED').length;
    return { answered, total: rows.length };
  }

  /**
   * Get all calls for a campaign (for metrics/reporting).
   */
  findByCampaign(campaignId: string): Call[] {
    const rows = this.db.prepare(
      'SELECT * FROM calls WHERE campaign_id = ?'
    ).all(campaignId) as Record<string, unknown>[];
    return rows.map(r => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): Call {
    return {
      id: row['id'] as string,
      campaignId: row['campaign_id'] as string,
      agentId: row['agent_id'] as string | null,
      borrowerId: row['borrower_id'] as string,
      providerCallId: row['provider_call_id'] as string | null,
      providerName: row['provider_name'] as string | null,
      state: row['state'] as CallState,
      attemptNumber: row['attempt_number'] as number,
      createdAt: row['created_at'] as string,
      initiatedAt: row['initiated_at'] as string | null,
      ringingAt: row['ringing_at'] as string | null,
      answeredAt: row['answered_at'] as string | null,
      connectedAt: row['connected_at'] as string | null,
      completedAt: row['completed_at'] as string | null,
      failureReason: row['failure_reason'] as string | null,
      version: row['version'] as number,
      lastProviderSequence: row['last_provider_sequence'] as number,
      updatedAt: row['updated_at'] as string,
    };
  }
}
