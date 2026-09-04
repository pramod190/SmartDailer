// ============================================================================
// Recovery Integration Tests
// ============================================================================

import { describe, it, expect } from 'vitest';
import { createTestDatabase } from '../helpers/testDb.js';
import { createConfig } from '../../src/config.js';
import { CampaignRepository } from '../../src/domain/campaign/CampaignRepository.js';
import { AgentRepository } from '../../src/domain/agent/AgentRepository.js';
import { BorrowerRepository } from '../../src/domain/borrower/BorrowerRepository.js';
import { CallRepository } from '../../src/domain/call/CallRepository.js';
import { ProviderHealthRepository } from '../../src/domain/provider/ProviderHealthRepository.js';
import { StaleReservationRecovery } from '../../src/recovery/StaleReservationRecovery.js';
import { ProviderOutageHandler } from '../../src/recovery/ProviderOutageHandler.js';

describe('StaleReservationRecovery', () => {
  it('detects and reclaims stale agent reservations and releases borrower', () => {
    const db = createTestDatabase();
    const config = createConfig({ recovery: { leaseTimeoutSec: 10 } as any });
    const campaigns = new CampaignRepository(db);
    const agentRepo = new AgentRepository(db);
    const borrowerRepo = new BorrowerRepository(db);
    const callRepo = new CallRepository(db);
    const recovery = new StaleReservationRecovery(db, config);

    const campaign = campaigns.create('Test Campaign', 'progressive');
    const agent = agentRepo.create(campaign.id, 'AVAILABLE');
    const borrower = borrowerRepo.create(campaign.id, '555-001');

    // Manually create a reserved call that timed out
    const call = callRepo.create({
      campaignId: campaign.id,
      agentId: agent.id,
      borrowerId: borrower.id,
      attemptNumber: 1,
    });
    callRepo.transitionState(call.id, 'RESERVED', call.version);
    borrowerRepo.allocate(borrower.id, borrower.version);

    // Reserve agent with timestamp 60 seconds ago (older than 10s lease)
    const pastTimestamp = new Date(Date.now() - 60000).toISOString();
    db.prepare(`
      UPDATE agents
      SET state = 'RESERVED',
          current_call_id = ?,
          reserved_at = ?,
          version = version + 1
      WHERE id = ?
    `).run(call.id, pastTimestamp, agent.id);

    // Run recovery
    const summary = recovery.recoverStaleReservations(campaign.id);

    expect(summary.agentsReclaimed).toBe(1);
    expect(summary.callsFailed).toBe(1);
    expect(summary.borrowersReleased).toBe(1);

    // Verify DB states
    const updatedAgent = agentRepo.findById(agent.id)!;
    expect(updatedAgent.state).toBe('AVAILABLE');
    expect(updatedAgent.currentCallId).toBeNull();
    expect(updatedAgent.reservedAt).toBeNull();

    const updatedCall = callRepo.findById(call.id)!;
    expect(updatedCall.state).toBe('FAILED');
    expect(updatedCall.failureReason).toBe('stale_reservation_timeout');

    const updatedBorrower = borrowerRepo.findById(borrower.id)!;
    expect(updatedBorrower.status).toBe('eligible');
  });

  it('does not reclaim fresh active reservations', () => {
    const db = createTestDatabase();
    const config = createConfig({ recovery: { leaseTimeoutSec: 60 } as any });
    const campaigns = new CampaignRepository(db);
    const agentRepo = new AgentRepository(db);
    const borrowerRepo = new BorrowerRepository(db);
    const callRepo = new CallRepository(db);
    const recovery = new StaleReservationRecovery(db, config);

    const campaign = campaigns.create('Test Campaign', 'progressive');
    const agent = agentRepo.create(campaign.id, 'AVAILABLE');
    const borrower = borrowerRepo.create(campaign.id, '555-002');

    const call = callRepo.create({
      campaignId: campaign.id,
      agentId: agent.id,
      borrowerId: borrower.id,
    });
    agentRepo.reserveAgent(agent.id, call.id, agent.version);

    // Run recovery - lease is 60s, reservation was just made
    const summary = recovery.recoverStaleReservations(campaign.id);

    expect(summary.agentsReclaimed).toBe(0);
    expect(summary.callsFailed).toBe(0);

    const checkAgent = agentRepo.findById(agent.id)!;
    expect(checkAgent.state).toBe('RESERVED');
  });
});

describe('ProviderOutageHandler', () => {
  it('returns HEALTHY for provider with normal metrics', () => {
    const db = createTestDatabase();
    const config = createConfig();
    const healthRepo = new ProviderHealthRepository(db);
    const outageHandler = new ProviderOutageHandler(db, config);

    healthRepo.recordSuccess('provider1', 100);

    const action = outageHandler.assessProvider('provider1');
    expect(action.status).toBe('HEALTHY');
    expect(action.allowDialing).toBe(true);
    expect(action.forceProgressive).toBe(false);
  });

  it('halts dialing when provider is UNHEALTHY', () => {
    const db = createTestDatabase();
    const config = createConfig();
    const healthRepo = new ProviderHealthRepository(db);
    const outageHandler = new ProviderOutageHandler(db, config);

    // Record enough consecutive failures to trip UNHEALTHY
    for (let i = 0; i < 15; i++) {
      healthRepo.recordFailure('flaky_provider');
    }

    const action = outageHandler.assessProvider('flaky_provider');
    expect(action.status).toBe('UNHEALTHY');
    expect(action.allowDialing).toBe(false);
  });
});
