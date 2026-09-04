// ============================================================================
// Integration Tests — Repositories
// ============================================================================
// Tests that repositories work correctly with the real database.
// Uses in-memory SQLite for speed.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/testDb.js';
import { CampaignRepository } from '../../src/domain/campaign/CampaignRepository.js';
import { AgentRepository } from '../../src/domain/agent/AgentRepository.js';
import { BorrowerRepository } from '../../src/domain/borrower/BorrowerRepository.js';
import { CallRepository } from '../../src/domain/call/CallRepository.js';
import { ProviderHealthRepository } from '../../src/domain/provider/ProviderHealthRepository.js';
import type { Database } from '../../src/infrastructure/database.js';

describe('Repositories', () => {
  let db: Database;
  let campaigns: CampaignRepository;
  let agents: AgentRepository;
  let borrowers: BorrowerRepository;
  let calls: CallRepository;
  let providerHealth: ProviderHealthRepository;

  beforeEach(() => {
    db = createTestDatabase();
    campaigns = new CampaignRepository(db);
    agents = new AgentRepository(db);
    borrowers = new BorrowerRepository(db);
    calls = new CallRepository(db);
    providerHealth = new ProviderHealthRepository(db);
  });

  // --- Campaign ---
  describe('CampaignRepository', () => {
    it('creates and retrieves a campaign', () => {
      const c = campaigns.create('Test Campaign', 'progressive');
      expect(c.id).toBeDefined();
      expect(c.name).toBe('Test Campaign');
      expect(c.mode).toBe('progressive');
      expect(c.status).toBe('created');

      const found = campaigns.findById(c.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(c.id);
    });

    it('updates campaign status', () => {
      const c = campaigns.create('Test', 'progressive');
      campaigns.updateStatus(c.id, 'active');
      const updated = campaigns.findById(c.id)!;
      expect(updated.status).toBe('active');
    });
  });

  // --- Agent ---
  describe('AgentRepository', () => {
    let campaignId: string;

    beforeEach(() => {
      const c = campaigns.create('Test', 'progressive');
      campaignId = c.id;
    });

    it('creates an agent', () => {
      const agent = agents.create(campaignId, 'AVAILABLE');
      expect(agent.id).toBeDefined();
      expect(agent.state).toBe('AVAILABLE');
      expect(agent.version).toBe(1);
    });

    it('finds available agents by campaign', () => {
      agents.create(campaignId, 'AVAILABLE');
      agents.create(campaignId, 'AVAILABLE');
      agents.create(campaignId, 'OFFLINE');

      const available = agents.findAvailableByCampaign(campaignId);
      expect(available.length).toBe(2);
    });

    it('reserves an agent with optimistic locking', () => {
      const agent = agents.create(campaignId, 'AVAILABLE');
      const success = agents.reserveAgent(agent.id, 'call-1', agent.version);
      expect(success).toBe(true);

      const reserved = agents.findById(agent.id)!;
      expect(reserved.state).toBe('RESERVED');
      expect(reserved.version).toBe(2);
      expect(reserved.currentCallId).toBe('call-1');
      expect(reserved.reservedAt).not.toBeNull();
    });

    it('rejects reservation with stale version', () => {
      const agent = agents.create(campaignId, 'AVAILABLE');

      // First reservation succeeds
      const success1 = agents.reserveAgent(agent.id, 'call-1', agent.version);
      expect(success1).toBe(true);

      // Second reservation with original version fails
      const success2 = agents.reserveAgent(agent.id, 'call-2', agent.version);
      expect(success2).toBe(false);
    });

    it('rejects reservation of non-AVAILABLE agent', () => {
      const agent = agents.create(campaignId, 'OFFLINE');
      const success = agents.reserveAgent(agent.id, 'call-1', agent.version);
      expect(success).toBe(false);
    });

    it('transitions state with validation', () => {
      const agent = agents.create(campaignId, 'AVAILABLE');
      const success = agents.transitionState(agent.id, 'RESERVED', agent.version);
      expect(success).toBe(true);

      const updated = agents.findById(agent.id)!;
      expect(updated.state).toBe('RESERVED');
      expect(updated.version).toBe(2);
    });

    it('rejects invalid state transitions', () => {
      const agent = agents.create(campaignId, 'AVAILABLE');
      expect(() => agents.transitionState(agent.id, 'CONNECTED', agent.version))
        .toThrow('Invalid agent state transition');
    });

    it('finds stale reservations', () => {
      const agent = agents.create(campaignId, 'AVAILABLE');
      agents.reserveAgent(agent.id, 'call-1', agent.version);

      // Manually backdate the reservation
      db.prepare("UPDATE agents SET reserved_at = datetime('now', '-120 seconds') WHERE id = ?")
        .run(agent.id);

      const stale = agents.findStaleReservations(60);
      expect(stale.length).toBe(1);
      expect(stale[0]!.id).toBe(agent.id);
    });

    it('counts agents by state', () => {
      agents.create(campaignId, 'AVAILABLE');
      agents.create(campaignId, 'AVAILABLE');
      agents.create(campaignId, 'OFFLINE');

      expect(agents.countByState(campaignId, 'AVAILABLE')).toBe(2);
      expect(agents.countByState(campaignId, 'OFFLINE')).toBe(1);
      expect(agents.countByState(campaignId, 'RESERVED')).toBe(0);
    });
  });

  // --- Borrower ---
  describe('BorrowerRepository', () => {
    let campaignId: string;

    beforeEach(() => {
      const c = campaigns.create('Test', 'progressive');
      campaignId = c.id;
    });

    it('creates and retrieves a borrower', () => {
      const b = borrowers.create(campaignId, '555-0100', 5);
      expect(b.id).toBeDefined();
      expect(b.status).toBe('eligible');
      expect(b.priority).toBe(5);
    });

    it('selects highest priority eligible borrower', () => {
      borrowers.create(campaignId, '555-0001', 1);
      borrowers.create(campaignId, '555-0002', 10);
      borrowers.create(campaignId, '555-0003', 5);

      const selected = borrowers.selectNextEligible(campaignId);
      expect(selected).not.toBeNull();
      expect(selected!.priority).toBe(10);
    });

    it('skips borrowers with future nextEligibleAt', () => {
      const b = borrowers.create(campaignId, '555-0001', 10);
      // Set next_eligible_at to future
      db.prepare("UPDATE borrowers SET next_eligible_at = datetime('now', '+60 seconds') WHERE id = ?")
        .run(b.id);

      const b2 = borrowers.create(campaignId, '555-0002', 1);

      const selected = borrowers.selectNextEligible(campaignId);
      expect(selected).not.toBeNull();
      expect(selected!.id).toBe(b2.id);  // Lower priority but eligible now
    });

    it('allocates borrower with optimistic locking', () => {
      const b = borrowers.create(campaignId, '555-0001');
      const success = borrowers.allocate(b.id, b.version);
      expect(success).toBe(true);

      const allocated = borrowers.findById(b.id)!;
      expect(allocated.status).toBe('allocated');
      expect(allocated.attemptCount).toBe(1);
    });

    it('rejects double allocation', () => {
      const b = borrowers.create(campaignId, '555-0001');
      const s1 = borrowers.allocate(b.id, b.version);
      expect(s1).toBe(true);

      // Second allocation with original version fails
      const s2 = borrowers.allocate(b.id, b.version);
      expect(s2).toBe(false);
    });

    it('releases allocated borrower back to eligible', () => {
      const b = borrowers.create(campaignId, '555-0001');
      borrowers.allocate(b.id, b.version);
      borrowers.release(b.id);

      const released = borrowers.findById(b.id)!;
      expect(released.status).toBe('eligible');
    });

    it('marks borrower as completed', () => {
      const b = borrowers.create(campaignId, '555-0001');
      borrowers.allocate(b.id, b.version);
      borrowers.complete(b.id);

      const completed = borrowers.findById(b.id)!;
      expect(completed.status).toBe('completed');
    });
  });

  // --- Call ---
  describe('CallRepository', () => {
    let campaignId: string;
    let agentId: string;
    let borrowerId: string;

    beforeEach(() => {
      const c = campaigns.create('Test', 'progressive');
      campaignId = c.id;
      const agent = agents.create(campaignId, 'AVAILABLE');
      agentId = agent.id;
      const borrower = borrowers.create(campaignId, '555-0001');
      borrowerId = borrower.id;
    });

    it('creates a call in QUEUED state', () => {
      const call = calls.create({ campaignId, agentId, borrowerId });
      expect(call.state).toBe('QUEUED');
      expect(call.version).toBe(1);
    });

    it('transitions call state with version check', () => {
      const call = calls.create({ campaignId, agentId, borrowerId });
      const success = calls.transitionState(call.id, 'RESERVED', call.version);
      expect(success).toBe(true);

      const updated = calls.findById(call.id)!;
      expect(updated.state).toBe('RESERVED');
      expect(updated.version).toBe(2);
    });

    it('rejects invalid call state transitions', () => {
      const call = calls.create({ campaignId, agentId, borrowerId });
      expect(() => calls.transitionState(call.id, 'CONNECTED', call.version))
        .toThrow('Invalid call state transition');
    });

    it('rejects transitions from terminal states', () => {
      const call = calls.create({ campaignId, agentId, borrowerId });
      calls.transitionState(call.id, 'RESERVED', call.version);
      const reserved = calls.findById(call.id)!;
      calls.transitionState(call.id, 'FAILED', reserved.version, { failureReason: 'timeout' });

      const failed = calls.findById(call.id)!;
      expect(() => calls.transitionState(call.id, 'INITIATED', failed.version))
        .toThrow('Invalid call state transition');
    });

    it('finds active calls by campaign', () => {
      calls.create({ campaignId, agentId, borrowerId });
      const active = calls.findActiveByCampaign(campaignId);
      expect(active.length).toBe(1);
    });

    it('sets provider call ID and name during transition', () => {
      const call = calls.create({ campaignId, agentId, borrowerId });
      calls.transitionState(call.id, 'RESERVED', call.version);
      const reserved = calls.findById(call.id)!;
      calls.transitionState(call.id, 'INITIATED', reserved.version, {
        providerCallId: 'prov-123',
        providerName: 'reliable-mock',
      });

      const initiated = calls.findById(call.id)!;
      expect(initiated.providerCallId).toBe('prov-123');
      expect(initiated.providerName).toBe('reliable-mock');
      expect(initiated.initiatedAt).not.toBeNull();
    });

    it('calculates answer rate from recent calls', () => {
      // Create some completed and failed calls
      for (let i = 0; i < 5; i++) {
        const b = borrowers.create(campaignId, `555-${i}000`);
        const c = calls.create({ campaignId, agentId, borrowerId: b.id });
        calls.transitionState(c.id, 'RESERVED', c.version);
        const r = calls.findById(c.id)!;
        calls.transitionState(c.id, 'INITIATED', r.version);
        const init = calls.findById(c.id)!;
        calls.transitionState(c.id, 'RINGING', init.version);
        const ring = calls.findById(c.id)!;

        if (i < 3) {
          calls.transitionState(c.id, 'ANSWERED', ring.version);
          const ans = calls.findById(c.id)!;
          calls.transitionState(c.id, 'CONNECTED', ans.version);
          const conn = calls.findById(c.id)!;
          calls.transitionState(c.id, 'COMPLETED', conn.version);
        } else {
          calls.transitionState(c.id, 'FAILED', ring.version, { failureReason: 'no answer' });
        }
      }

      const stats = calls.getRecentCallStats(campaignId, 100);
      expect(stats.total).toBe(5);
      expect(stats.answered).toBe(3);  // 60% answer rate
    });
  });

  // --- Provider Health ---
  describe('ProviderHealthRepository', () => {
    it('records successes and updates health', () => {
      providerHealth.recordSuccess('reliable-mock', 100);
      providerHealth.recordSuccess('reliable-mock', 150);

      const health = providerHealth.findByName('reliable-mock')!;
      expect(health.totalCalls).toBe(2);
      expect(health.successfulCalls).toBe(2);
      expect(health.consecutiveFailures).toBe(0);
      expect(health.healthStatus).toBe('HEALTHY');
    });

    it('degrades health after consecutive failures', () => {
      providerHealth.ensureExists('flaky-provider');

      // 3 consecutive failures → DEGRADED
      for (let i = 0; i < 3; i++) {
        providerHealth.recordFailure('flaky-provider');
      }

      let health = providerHealth.findByName('flaky-provider')!;
      expect(health.healthStatus).toBe('DEGRADED');

      // 10 consecutive failures → UNHEALTHY
      for (let i = 0; i < 7; i++) {
        providerHealth.recordFailure('flaky-provider');
      }

      health = providerHealth.findByName('flaky-provider')!;
      expect(health.healthStatus).toBe('UNHEALTHY');
    });

    it('recovers health after success', () => {
      providerHealth.ensureExists('recovering');

      for (let i = 0; i < 5; i++) {
        providerHealth.recordFailure('recovering');
      }
      expect(providerHealth.findByName('recovering')!.healthStatus).toBe('DEGRADED');

      // Success resets consecutive failures
      providerHealth.recordSuccess('recovering', 100);
      const health = providerHealth.findByName('recovering')!;
      expect(health.consecutiveFailures).toBe(0);
    });
  });
});
