// ============================================================================
// SmartDialer — Agent Repository
// ============================================================================
// Database operations for agents. All mutations use optimistic locking via
// the version column. The critical reserveAgent() method uses
// UPDATE ... WHERE state='AVAILABLE' AND version=? to ensure only one
// worker can successfully reserve an agent.
// ============================================================================

import { v4 as uuid } from 'uuid';
import type { Database } from '../../infrastructure/database.js';
import { AgentStateMachine, type Agent, type AgentState } from './AgentState.js';
import { logger } from '../../common/logger.js';

export class AgentRepository {
  constructor(private readonly db: Database) {}

  create(campaignId: string, state: AgentState = 'OFFLINE'): Agent {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO agents (id, campaign_id, state, version, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(id, campaignId, state, now, now);

    return this.findById(id)!;
  }

  findById(id: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findAvailableByCampaign(campaignId: string): Agent[] {
    const rows = this.db.prepare(
      "SELECT * FROM agents WHERE campaign_id = ? AND state = 'AVAILABLE'"
    ).all(campaignId) as Record<string, unknown>[];
    return rows.map(r => this.mapRow(r));
  }

  findByCampaign(campaignId: string): Agent[] {
    const rows = this.db.prepare(
      'SELECT * FROM agents WHERE campaign_id = ?'
    ).all(campaignId) as Record<string, unknown>[];
    return rows.map(r => this.mapRow(r));
  }

  countByState(campaignId: string, state: AgentState): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM agents WHERE campaign_id = ? AND state = ?'
    ).get(campaignId, state) as { count: number };
    return row.count;
  }

  countByStates(campaignId: string, states: AgentState[]): Record<AgentState, number> {
    const result: Record<string, number> = {};
    for (const state of states) {
      result[state] = this.countByState(campaignId, state);
    }
    return result as Record<AgentState, number>;
  }

  /**
   * CRITICAL: Atomic agent reservation using optimistic locking.
   *
   * UPDATE agents
   *   SET state = 'RESERVED', version = version + 1, reserved_at = now
   *   WHERE id = ? AND state = 'AVAILABLE' AND version = ?
   *
   * Returns true if reservation succeeded (exactly 1 row updated).
   * Returns false if another worker already reserved this agent.
   *
   * This is the PRIMARY concurrency control mechanism.
   */
  reserveAgent(agentId: string, callId: string, expectedVersion: number): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE agents
      SET state = 'RESERVED',
          version = version + 1,
          reserved_at = ?,
          current_call_id = ?,
          updated_at = ?
      WHERE id = ?
        AND state = 'AVAILABLE'
        AND version = ?
    `).run(now, callId, now, agentId, expectedVersion);

    const success = result.changes === 1;

    logger.debug(
      success ? 'Agent reserved successfully' : 'Agent reservation failed (conflict)',
      { agentId, callId, component: 'AgentRepository' }
    );

    return success;
  }

  /**
   * Transition agent state with optimistic locking.
   * Validates the transition using the state machine first.
   */
  transitionState(agentId: string, targetState: AgentState, expectedVersion: number): boolean {
    const agent = this.findById(agentId);
    if (!agent) return false;

    // Validate transition
    AgentStateMachine.validateTransition(agent.state, targetState);

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      state: targetState,
      updatedAt: now,
    };

    // Clear reservation data when becoming available
    if (targetState === 'AVAILABLE') {
      updates.reservedAt = null;
      updates.currentCallId = null;
    }

    const result = this.db.prepare(`
      UPDATE agents
      SET state = ?,
          version = version + 1,
          reserved_at = CASE WHEN ? = 'AVAILABLE' THEN NULL ELSE reserved_at END,
          current_call_id = CASE WHEN ? = 'AVAILABLE' THEN NULL ELSE current_call_id END,
          updated_at = ?
      WHERE id = ?
        AND version = ?
    `).run(targetState, targetState, targetState, now, agentId, expectedVersion);

    return result.changes === 1;
  }

  /**
   * Find agents with stale reservations (for recovery).
   * An agent is "stale" if reserved_at + timeout < now.
   */
  findStaleReservations(timeoutSec: number): Agent[] {
    const cutoff = new Date(Date.now() - timeoutSec * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM agents
      WHERE state = 'RESERVED'
        AND reserved_at IS NOT NULL
        AND reserved_at < ?
    `).all(cutoff) as Record<string, unknown>[];
    return rows.map(r => this.mapRow(r));
  }

  /**
   * Force-release a stale agent reservation (for recovery).
   * Uses version check to prevent race conditions.
   */
  releaseStaleReservation(agentId: string, expectedVersion: number): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE agents
      SET state = 'AVAILABLE',
          version = version + 1,
          reserved_at = NULL,
          current_call_id = NULL,
          updated_at = ?
      WHERE id = ?
        AND state = 'RESERVED'
        AND version = ?
    `).run(now, agentId, expectedVersion);
    return result.changes === 1;
  }

  /**
   * Bulk set agents to a state (used in simulation for setup/teardown).
   */
  setStateBulk(campaignId: string, state: AgentState): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE agents SET state = ?, version = version + 1, updated_at = ?
      WHERE campaign_id = ?
    `).run(state, now, campaignId);
  }

  /**
   * Update agent heartbeat timestamp.
   */
  updateHeartbeat(agentId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE agents
      SET last_heartbeat_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, agentId);
    return result.changes === 1;
  }

  private mapRow(row: Record<string, unknown>): Agent {
    return {
      id: row['id'] as string,
      campaignId: row['campaign_id'] as string,
      state: row['state'] as AgentState,
      version: row['version'] as number,
      reservedAt: row['reserved_at'] as string | null,
      lastHeartbeatAt: row['last_heartbeat_at'] as string | null,
      currentCallId: row['current_call_id'] as string | null,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }
}
