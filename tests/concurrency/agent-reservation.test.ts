// ============================================================================
// CONCURRENCY TEST — Agent Reservation
// ============================================================================
// This is the MOST CRITICAL test in the entire project.
//
// Scenario: 100 "workers" attempt to reserve 1 available agent.
// Expected: EXACTLY 1 reservation succeeds. The other 99 fail.
//
// How it works:
// The UPDATE ... WHERE id=? AND state='AVAILABLE' AND version=? query is an
// atomic compare-and-swap. Only the first writer succeeds — subsequent
// writers see version has changed and get 0 affected rows.
//
// This pattern works identically on PostgreSQL under READ COMMITTED isolation.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/testDb.js';
import { AgentRepository } from '../../src/domain/agent/AgentRepository.js';
import { BorrowerRepository } from '../../src/domain/borrower/BorrowerRepository.js';
import { CampaignRepository } from '../../src/domain/campaign/CampaignRepository.js';
import type { Database } from '../../src/infrastructure/database.js';

describe('Concurrency: Agent Reservation', () => {
  let db: Database;
  let agents: AgentRepository;
  let campaigns: CampaignRepository;
  let campaignId: string;

  beforeEach(() => {
    db = createTestDatabase();
    agents = new AgentRepository(db);
    campaigns = new CampaignRepository(db);
    const c = campaigns.create('Concurrency Test', 'progressive');
    campaignId = c.id;
  });

  it('100 workers attempting to reserve 1 agent → exactly 1 succeeds', () => {
    // Setup: 1 available agent
    const agent = agents.create(campaignId, 'AVAILABLE');
    const NUM_WORKERS = 100;

    // All workers read the same snapshot (simulating concurrent reads)
    const snapshotVersion = agent.version;

    // Verify preconditions
    expect(snapshotVersion).toBe(1);
    expect(agent.state).toBe('AVAILABLE');

    // All workers attempt to reserve with the same version
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < NUM_WORKERS; i++) {
      const success = agents.reserveAgent(agent.id, `call-${i}`, snapshotVersion);
      if (success) successCount++;
      else failCount++;
    }

    // THE CRITICAL ASSERTION: exactly 1 reservation succeeds
    expect(successCount).toBe(1);
    expect(failCount).toBe(NUM_WORKERS - 1);

    // Verify the agent's final state
    const finalAgent = agents.findById(agent.id)!;
    expect(finalAgent.state).toBe('RESERVED');
    expect(finalAgent.version).toBe(2);  // Only incremented once
    expect(finalAgent.currentCallId).toBeDefined();
  });

  it('50 workers reserving 10 agents → exactly 10 reservations', () => {
    // Setup: 10 available agents
    const agentIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const agent = agents.create(campaignId, 'AVAILABLE');
      agentIds.push(agent.id);
    }

    const NUM_WORKERS = 50;
    let totalSuccess = 0;
    const reservedAgents = new Set<string>();

    // Each worker tries to reserve any available agent
    for (let w = 0; w < NUM_WORKERS; w++) {
      const available = agents.findAvailableByCampaign(campaignId);

      for (const candidate of available) {
        const success = agents.reserveAgent(candidate.id, `call-${w}`, candidate.version);
        if (success) {
          totalSuccess++;
          reservedAgents.add(candidate.id);
          break;  // Worker got an agent, stop trying
        }
      }
    }

    // Exactly 10 agents should be reserved
    expect(totalSuccess).toBe(10);
    expect(reservedAgents.size).toBe(10);

    // Verify all agents are reserved
    for (const agentId of agentIds) {
      const agent = agents.findById(agentId)!;
      expect(agent.state).toBe('RESERVED');
    }

    // No available agents left
    expect(agents.findAvailableByCampaign(campaignId).length).toBe(0);
  });

  it('version column prevents double-update even after successful reservation', () => {
    const agent = agents.create(campaignId, 'AVAILABLE');

    // Worker 1 reads version, reserves successfully
    const v1 = agent.version;
    const success1 = agents.reserveAgent(agent.id, 'call-1', v1);
    expect(success1).toBe(true);

    // Worker 2 tries to reserve using stale version → fails
    // (reserveAgent also checks state=AVAILABLE, which is now RESERVED)
    const success2 = agents.reserveAgent(agent.id, 'call-2', v1);
    expect(success2).toBe(false);

    // Worker 3 reads fresh state, transitions correctly
    const updatedAgent = agents.findById(agent.id)!;
    expect(updatedAgent.version).toBe(2);
    expect(updatedAgent.state).toBe('RESERVED');

    // Only DIALING is valid from RESERVED (not another RESERVED)
    const success3 = agents.transitionState(agent.id, 'DIALING', updatedAgent.version);
    expect(success3).toBe(true);

    const finalAgent = agents.findById(agent.id)!;
    expect(finalAgent.state).toBe('DIALING');
    expect(finalAgent.version).toBe(3);
  });

  it('reservation lease prevents permanent lock', () => {
    const agent = agents.create(campaignId, 'AVAILABLE');
    agents.reserveAgent(agent.id, 'call-1', agent.version);

    // Simulate stale reservation (backdate reserved_at)
    db.prepare("UPDATE agents SET reserved_at = datetime('now', '-120 seconds') WHERE id = ?")
      .run(agent.id);

    // Recovery process finds stale reservations (60 sec timeout)
    const stale = agents.findStaleReservations(60);
    expect(stale.length).toBe(1);
    expect(stale[0]!.id).toBe(agent.id);

    // Recovery releases the stale reservation
    const released = agents.releaseStaleReservation(agent.id, stale[0]!.version);
    expect(released).toBe(true);

    const recoveredAgent = agents.findById(agent.id)!;
    expect(recoveredAgent.state).toBe('AVAILABLE');

    // Agent can now be reserved again
    const reservedAgain = agents.reserveAgent(agent.id, 'call-2', recoveredAgent.version);
    expect(reservedAgain).toBe(true);
  });

  it('agent state cannot skip from AVAILABLE to CONNECTED', () => {
    const agent = agents.create(campaignId, 'AVAILABLE');

    // Cannot skip RESERVED and DIALING
    expect(() => agents.transitionState(agent.id, 'CONNECTED', agent.version))
      .toThrow('Invalid agent state transition');

    // Proper path: AVAILABLE → RESERVED → DIALING → CONNECTED
    agents.reserveAgent(agent.id, 'call-1', agent.version);
    const reserved = agents.findById(agent.id)!;
    agents.transitionState(reserved.id, 'DIALING', reserved.version);
    const dialing = agents.findById(agent.id)!;
    agents.transitionState(dialing.id, 'CONNECTED', dialing.version);
    const connected = agents.findById(agent.id)!;
    expect(connected.state).toBe('CONNECTED');
    expect(connected.version).toBe(4); // 1→2(reserve)→3(dial)→4(connect)
  });
});

describe('Concurrency: Borrower Allocation', () => {
  let db: Database;
  let campaigns: CampaignRepository;
  let borrowers: BorrowerRepository;
  let campaignId: string;

  beforeEach(() => {
    db = createTestDatabase();
    campaigns = new CampaignRepository(db);
    borrowers = new BorrowerRepository(db);
    const c = campaigns.create('Borrower Concurrency Test', 'progressive');
    campaignId = c.id;
  });

  it('two workers cannot allocate the same borrower', () => {
    const borrower = borrowers.create(campaignId, '555-0001', 10);

    // Both workers read the same version
    const version = borrower.version;

    // Worker 1 allocates successfully
    const success1 = borrowers.allocate(borrower.id, version);
    expect(success1).toBe(true);

    // Worker 2 tries with same stale version
    const success2 = borrowers.allocate(borrower.id, version);
    expect(success2).toBe(false);

    // Verify borrower is allocated exactly once
    const final = borrowers.findById(borrower.id)!;
    expect(final.status).toBe('allocated');
    expect(final.attemptCount).toBe(1);
    expect(final.version).toBe(2);
  });

  it('100 workers allocating from pool of 5 borrowers → exactly 5 allocations', () => {
    // Create 5 borrowers
    for (let i = 0; i < 5; i++) {
      borrowers.create(campaignId, `555-000${i}`, i);
    }

    const NUM_WORKERS = 100;
    let totalAllocations = 0;

    for (let w = 0; w < NUM_WORKERS; w++) {
      const borrower = borrowers.selectNextEligible(campaignId);
      if (!borrower) continue;

      const success = borrowers.allocate(borrower.id, borrower.version);
      if (success) totalAllocations++;
    }

    // Exactly 5 borrowers should be allocated
    expect(totalAllocations).toBe(5);
    expect(borrowers.countByStatus(campaignId, 'allocated')).toBe(5);
    expect(borrowers.countByStatus(campaignId, 'eligible')).toBe(0);
  });
});
