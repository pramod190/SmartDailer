// ============================================================================
// Tests — Provider Event Handler (Idempotency + Ordering + State Machine)
// ============================================================================
// Tests the three layers of event processing protection:
// 1. Duplicate event rejection (idempotency)
// 2. Out-of-order event rejection (sequence numbers + state precedence)
// 3. Terminal state protection (state machine)
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/testDb.js';
import { ProviderEventHandler } from '../../src/events/ProviderEventHandler.js';
import { CampaignRepository } from '../../src/domain/campaign/CampaignRepository.js';
import { AgentRepository } from '../../src/domain/agent/AgentRepository.js';
import { BorrowerRepository } from '../../src/domain/borrower/BorrowerRepository.js';
import { CallRepository } from '../../src/domain/call/CallRepository.js';
import type { ProviderEvent } from '../../src/provider/TelecomProvider.js';
import type { Database } from '../../src/infrastructure/database.js';
import { createConfig } from '../../src/config.js';
import { v4 as uuid } from 'uuid';

function makeEvent(
  providerCallId: string,
  eventType: ProviderEvent['eventType'],
  seq: number,
  eventId?: string,
): ProviderEvent {
  return {
    eventId: eventId ?? uuid(),
    providerCallId,
    eventType,
    sequenceNumber: seq,
    timestamp: new Date().toISOString(),
    payload: {},
  };
}

describe('ProviderEventHandler', () => {
  let db: Database;
  let handler: ProviderEventHandler;
  let campaigns: CampaignRepository;
  let agents: AgentRepository;
  let borrowers: BorrowerRepository;
  let calls: CallRepository;
  let campaignId: string;
  const config = createConfig();

  beforeEach(() => {
    db = createTestDatabase();
    handler = new ProviderEventHandler(db, config);
    campaigns = new CampaignRepository(db);
    agents = new AgentRepository(db);
    borrowers = new BorrowerRepository(db);
    calls = new CallRepository(db);

    const c = campaigns.create('Event Test', 'progressive');
    campaignId = c.id;
  });

  // Helper: create a call in INITIATED state with a provider call ID
  function setupInitiatedCall(): { callId: string; providerCallId: string; agentId: string; borrowerId: string } {
    const agent = agents.create(campaignId, 'AVAILABLE');
    const borrower = borrowers.create(campaignId, '555-0001');
    const call = calls.create({ campaignId, agentId: agent.id, borrowerId: borrower.id });

    // Move through: QUEUED → RESERVED → INITIATED
    calls.transitionState(call.id, 'RESERVED', call.version);
    const reserved = calls.findById(call.id)!;

    const providerCallId = `prov-${uuid().substring(0, 8)}`;
    calls.transitionState(call.id, 'INITIATED', reserved.version, {
      providerCallId,
      providerName: 'test-provider',
    });

    // Reserve agent and transition to DIALING
    agents.reserveAgent(agent.id, call.id, agent.version);
    const reservedAgent = agents.findById(agent.id)!;
    agents.transitionState(agent.id, 'DIALING', reservedAgent.version);

    // Allocate borrower
    borrowers.allocate(borrower.id, borrower.version);

    return { callId: call.id, providerCallId, agentId: agent.id, borrowerId: borrower.id };
  }

  // --- Normal event flow ---
  describe('normal event flow', () => {
    it('processes RINGING → ANSWERED → CONNECTED → COMPLETED correctly', () => {
      const { callId, providerCallId } = setupInitiatedCall();

      const r1 = handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));
      expect(r1.processed).toBe(true);
      expect(r1.newState).toBe('RINGING');

      const r2 = handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2));
      expect(r2.processed).toBe(true);
      expect(r2.newState).toBe('ANSWERED');

      const r3 = handler.processEvent(makeEvent(providerCallId, 'CONNECTED', 3));
      expect(r3.processed).toBe(true);
      expect(r3.newState).toBe('CONNECTED');

      const r4 = handler.processEvent(makeEvent(providerCallId, 'COMPLETED', 4));
      expect(r4.processed).toBe(true);
      expect(r4.newState).toBe('COMPLETED');

      // Verify final call state
      const finalCall = calls.findById(callId)!;
      expect(finalCall.state).toBe('COMPLETED');
      expect(finalCall.lastProviderSequence).toBe(4);
    });

    it('processes RINGING → FAILED correctly', () => {
      const { callId, providerCallId, agentId } = setupInitiatedCall();

      handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));
      handler.processEvent(makeEvent(providerCallId, 'FAILED', 2));

      const finalCall = calls.findById(callId)!;
      expect(finalCall.state).toBe('FAILED');

      // Agent should be released back to AVAILABLE
      const finalAgent = agents.findById(agentId)!;
      expect(finalAgent.state).toBe('AVAILABLE');
    });
  });

  // --- DUPLICATE EVENT HANDLING (CRITICAL) ---
  describe('duplicate event handling', () => {
    it('ANSWERED × 3 processes only once', () => {
      const { providerCallId } = setupInitiatedCall();

      // Get to RINGING first
      handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));

      // Send ANSWERED three times with the same eventId
      const eventId = uuid();
      const r1 = handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2, eventId));
      const r2 = handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2, eventId));
      const r3 = handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2, eventId));

      expect(r1.processed).toBe(true);
      expect(r2.duplicate).toBe(true);
      expect(r2.processed).toBe(false);
      expect(r3.duplicate).toBe(true);
      expect(r3.processed).toBe(false);
    });

    it('ANSWERED with different event IDs but same sequence are stale', () => {
      const { providerCallId } = setupInitiatedCall();

      handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));

      // First ANSWERED succeeds
      const r1 = handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2));
      expect(r1.processed).toBe(true);

      // Second ANSWERED with different eventId but same sequence → stale
      const r2 = handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2));
      expect(r2.stale).toBe(true);
      expect(r2.processed).toBe(false);
    });
  });

  // --- OUT-OF-ORDER EVENT HANDLING (CRITICAL) ---
  describe('out-of-order event handling', () => {
    it('COMPLETED then ANSWERED is rejected', () => {
      const { providerCallId } = setupInitiatedCall();

      // Skip to COMPLETED
      handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));
      handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2));
      handler.processEvent(makeEvent(providerCallId, 'CONNECTED', 3));
      handler.processEvent(makeEvent(providerCallId, 'COMPLETED', 4));

      // Late ANSWERED arrives → stale (terminal state + sequence check)
      const result = handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2));
      expect(result.processed).toBe(false);
      expect(result.stale).toBe(true);
    });

    it('COMPLETED then RINGING is rejected', () => {
      const { providerCallId } = setupInitiatedCall();

      handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));
      handler.processEvent(makeEvent(providerCallId, 'FAILED', 2));

      // Late RINGING with lower sequence → stale
      const result = handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));
      expect(result.processed).toBe(false);
    });

    it('higher sequence number event arriving before lower is processed', () => {
      const { providerCallId } = setupInitiatedCall();

      // ANSWERED arrives before RINGING (out of order)
      // INITIATED → ANSWERED is valid (some providers skip RINGING)
      const r1 = handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2));
      expect(r1.processed).toBe(true);

      // Now RINGING arrives with lower sequence → stale
      const r2 = handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));
      expect(r2.stale).toBe(true);
      expect(r2.processed).toBe(false);
    });
  });

  // --- TERMINAL STATE PROTECTION ---
  describe('terminal state protection', () => {
    it('no events can transition a COMPLETED call', () => {
      const { providerCallId } = setupInitiatedCall();

      handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));
      handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2));
      handler.processEvent(makeEvent(providerCallId, 'CONNECTED', 3));
      handler.processEvent(makeEvent(providerCallId, 'COMPLETED', 4));

      // Try every event type — all should be rejected
      for (const eventType of ['RINGING', 'ANSWERED', 'CONNECTED', 'COMPLETED', 'FAILED', 'CANCELLED'] as const) {
        const result = handler.processEvent(makeEvent(providerCallId, eventType, 5));
        expect(result.processed).toBe(false);
      }
    });

    it('no events can transition a FAILED call', () => {
      const { providerCallId } = setupInitiatedCall();

      handler.processEvent(makeEvent(providerCallId, 'FAILED', 1));

      for (const eventType of ['RINGING', 'ANSWERED', 'CONNECTED', 'COMPLETED', 'FAILED'] as const) {
        const result = handler.processEvent(makeEvent(providerCallId, eventType, 2));
        expect(result.processed).toBe(false);
      }
    });
  });

  // --- AGENT SIDE EFFECTS ---
  describe('agent side effects', () => {
    it('agent transitions to CONNECTED when call is CONNECTED', () => {
      const { providerCallId, agentId } = setupInitiatedCall();

      handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));
      handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2));
      handler.processEvent(makeEvent(providerCallId, 'CONNECTED', 3));

      const agent = agents.findById(agentId)!;
      expect(agent.state).toBe('CONNECTED');
    });

    it('agent returns to AVAILABLE after call COMPLETED', () => {
      const { providerCallId, agentId } = setupInitiatedCall();

      handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));
      handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2));
      handler.processEvent(makeEvent(providerCallId, 'CONNECTED', 3));
      handler.processEvent(makeEvent(providerCallId, 'COMPLETED', 4));

      const agent = agents.findById(agentId)!;
      expect(agent.state).toBe('AVAILABLE');
    });

    it('agent returns to AVAILABLE after call FAILED', () => {
      const { providerCallId, agentId } = setupInitiatedCall();

      handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));
      handler.processEvent(makeEvent(providerCallId, 'FAILED', 2));

      const agent = agents.findById(agentId)!;
      expect(agent.state).toBe('AVAILABLE');
    });
  });

  // --- BORROWER SIDE EFFECTS ---
  describe('borrower side effects', () => {
    it('borrower is completed after successful call', () => {
      const { providerCallId, borrowerId } = setupInitiatedCall();

      handler.processEvent(makeEvent(providerCallId, 'RINGING', 1));
      handler.processEvent(makeEvent(providerCallId, 'ANSWERED', 2));
      handler.processEvent(makeEvent(providerCallId, 'CONNECTED', 3));
      handler.processEvent(makeEvent(providerCallId, 'COMPLETED', 4));

      const borrower = borrowers.findById(borrowerId)!;
      expect(borrower.status).toBe('completed');
    });

    it('borrower is released for retry after failed call', () => {
      const { providerCallId, borrowerId } = setupInitiatedCall();

      handler.processEvent(makeEvent(providerCallId, 'FAILED', 1));

      const borrower = borrowers.findById(borrowerId)!;
      expect(borrower.status).toBe('eligible');
      expect(borrower.nextEligibleAt).not.toBeNull();
    });
  });
});
