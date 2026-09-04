// ============================================================================
// Tests — Progressive Dialer + Providers
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/testDb.js';
import { ProgressiveDialer } from '../../src/pacing/ProgressiveDialer.js';
import { ProviderEventHandler } from '../../src/events/ProviderEventHandler.js';
import { ReliableMockProvider } from '../../src/provider/ReliableMockProvider.js';
import { UnreliableMockProvider } from '../../src/provider/UnreliableMockProvider.js';
import { CampaignRepository } from '../../src/domain/campaign/CampaignRepository.js';
import { AgentRepository } from '../../src/domain/agent/AgentRepository.js';
import { BorrowerRepository } from '../../src/domain/borrower/BorrowerRepository.js';
import { CallRepository } from '../../src/domain/call/CallRepository.js';
import type { Database } from '../../src/infrastructure/database.js';
import { createConfig, type SmartDialerConfig } from '../../src/config.js';

describe('ProgressiveDialer', () => {
  let db: Database;
  let config: SmartDialerConfig;
  let dialer: ProgressiveDialer;
  let campaigns: CampaignRepository;
  let agents: AgentRepository;
  let borrowers: BorrowerRepository;
  let calls: CallRepository;
  let campaignId: string;

  beforeEach(() => {
    db = createTestDatabase();
    config = createConfig({ pacing: { safetyBuffer: 1 } } as Partial<SmartDialerConfig>);
    dialer = new ProgressiveDialer(db, config);
    campaigns = new CampaignRepository(db);
    agents = new AgentRepository(db);
    borrowers = new BorrowerRepository(db);
    calls = new CallRepository(db);

    const c = campaigns.create('Progressive Test', 'progressive');
    campaignId = c.id;
  });

  it('allocates calls up to available agents minus safety buffer', () => {
    // 5 agents, safety buffer 1 → max 4 calls
    for (let i = 0; i < 5; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }
    for (let i = 0; i < 10; i++) {
      borrowers.create(campaignId, `555-${i.toString().padStart(4, '0')}`);
    }

    const result = dialer.tickAllocateOnly(campaignId);

    expect(result.availableAgents).toBe(5);
    expect(result.safeCapacity).toBe(4);  // 5 - 1 buffer
    expect(result.callsSucceeded).toBe(4);
    expect(result.callsFailed).toBe(0);

    // Verify: 4 agents are now RESERVED, 1 still AVAILABLE
    expect(agents.countByState(campaignId, 'RESERVED')).toBe(4);
    expect(agents.countByState(campaignId, 'AVAILABLE')).toBe(1);
  });

  it('cannot allocate more calls than available borrowers', () => {
    // 10 agents but only 3 borrowers
    for (let i = 0; i < 10; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }
    for (let i = 0; i < 3; i++) {
      borrowers.create(campaignId, `555-${i}`);
    }

    const result = dialer.tickAllocateOnly(campaignId);

    expect(result.callsSucceeded).toBe(3);
    expect(agents.countByState(campaignId, 'RESERVED')).toBe(3);
    expect(agents.countByState(campaignId, 'AVAILABLE')).toBe(7);
  });

  it('does nothing when no agents are available', () => {
    for (let i = 0; i < 5; i++) {
      agents.create(campaignId, 'OFFLINE');
    }
    for (let i = 0; i < 5; i++) {
      borrowers.create(campaignId, `555-${i}`);
    }

    const result = dialer.tickAllocateOnly(campaignId);

    expect(result.callsAttempted).toBe(0);
    expect(result.callsSucceeded).toBe(0);
  });

  it('does nothing when no borrowers are eligible', () => {
    for (let i = 0; i < 5; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }

    const result = dialer.tickAllocateOnly(campaignId);

    expect(result.callsAttempted).toBe(1);  // Attempts 1 allocation, discovers no borrowers
    expect(result.callsSucceeded).toBe(0);
  });

  it('respects safety buffer with buffer=0', () => {
    const config0 = createConfig({ pacing: { safetyBuffer: 0 } } as Partial<SmartDialerConfig>);
    const dialer0 = new ProgressiveDialer(db, config0);

    for (let i = 0; i < 3; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }
    for (let i = 0; i < 10; i++) {
      borrowers.create(campaignId, `555-${i}`);
    }

    const result = dialer0.tickAllocateOnly(campaignId);
    expect(result.safeCapacity).toBe(3);  // No buffer
    expect(result.callsSucceeded).toBe(3);
  });
});

describe('ProgressiveDialer + ReliableMockProvider (full flow)', () => {
  let db: Database;
  let config: SmartDialerConfig;
  let eventHandler: ProviderEventHandler;
  let campaigns: CampaignRepository;
  let agents: AgentRepository;
  let borrowers: BorrowerRepository;
  let calls: CallRepository;
  let campaignId: string;

  beforeEach(() => {
    db = createTestDatabase();
    config = createConfig({ pacing: { safetyBuffer: 0 } } as Partial<SmartDialerConfig>);
    eventHandler = new ProviderEventHandler(db, config);
    campaigns = new CampaignRepository(db);
    agents = new AgentRepository(db);
    borrowers = new BorrowerRepository(db);
    calls = new CallRepository(db);

    const c = campaigns.create('Full Flow Test', 'progressive');
    campaignId = c.id;
  });

  it('end-to-end: progressive dialing with reliable provider', () => {
    // Setup
    for (let i = 0; i < 3; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }
    for (let i = 0; i < 5; i++) {
      borrowers.create(campaignId, `555-${i.toString().padStart(4, '0')}`);
    }

    const provider = new ReliableMockProvider({ answerRate: 1.0, failureRate: 0 }, 42);
    const dialer = new ProgressiveDialer(db, config);

    // Tick 1: allocate and initiate calls
    const result = dialer.tick(campaignId, provider);
    expect(result.callsSucceeded).toBe(3);

    // All agents should be DIALING
    expect(agents.countByState(campaignId, 'DIALING')).toBe(3);

    // Process all provider events
    const events = provider.drainEvents();
    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      eventHandler.processEvent(event);
    }

    // After all events: agents should be AVAILABLE again, calls COMPLETED
    expect(agents.countByState(campaignId, 'AVAILABLE')).toBe(3);

    const allCalls = calls.findByCampaign(campaignId);
    const completedCalls = allCalls.filter(c => c.state === 'COMPLETED');
    expect(completedCalls.length).toBe(3);
  });
});

describe('ProgressiveDialer + UnreliableMockProvider', () => {
  let db: Database;
  let config: SmartDialerConfig;
  let eventHandler: ProviderEventHandler;
  let campaigns: CampaignRepository;
  let agents: AgentRepository;
  let borrowers: BorrowerRepository;
  let calls: CallRepository;
  let campaignId: string;

  beforeEach(() => {
    db = createTestDatabase();
    config = createConfig({ pacing: { safetyBuffer: 0 } } as Partial<SmartDialerConfig>);
    eventHandler = new ProviderEventHandler(db, config);
    campaigns = new CampaignRepository(db);
    agents = new AgentRepository(db);
    borrowers = new BorrowerRepository(db);
    calls = new CallRepository(db);

    const c = campaigns.create('Unreliable Flow Test', 'progressive');
    campaignId = c.id;
  });

  it('system remains correct with unreliable provider (duplicates + reordering)', () => {
    for (let i = 0; i < 5; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }
    for (let i = 0; i < 10; i++) {
      borrowers.create(campaignId, `555-${i.toString().padStart(4, '0')}`);
    }

    // Use deterministic seed so results are reproducible
    const provider = new UnreliableMockProvider({
      failureRate: 0.0,       // No initiation failures for this test
      timeoutRate: 0.0,
      answerRate: 0.5,
      duplicateEventRate: 0.5, // High duplicate rate
      outOfOrderRate: 0.3,     // High reorder rate
    }, 12345);

    const dialer = new ProgressiveDialer(db, config);
    const result = dialer.tick(campaignId, provider);
    expect(result.callsSucceeded).toBeGreaterThan(0);

    // Process all events (including duplicates and out-of-order)
    const events = provider.drainEvents();
    let duplicatesDetected = 0;
    let staleDetected = 0;
    let invalidTransitions = 0;

    for (const event of events) {
      const r = eventHandler.processEvent(event);
      if (r.duplicate) duplicatesDetected++;
      if (r.stale) staleDetected++;
      if (r.invalidTransition) invalidTransitions++;
    }

    // System should have handled duplicates/reordering safely
    // Some events should have been rejected as duplicates or stale

    // KEY INVARIANT: all calls end in terminal state or remain active
    const allCalls = calls.findByCampaign(campaignId);
    for (const call of allCalls) {
      if (call.state === 'CANCELLED') continue; // Cancelled during allocation conflict
      // Every non-cancelled call should be in a valid state
      expect([
        'QUEUED', 'RESERVED', 'INITIATED', 'RINGING',
        'ANSWERED', 'CONNECTED', 'COMPLETED', 'FAILED', 'CANCELLED',
      ]).toContain(call.state);
    }

    // KEY INVARIANT: no agent has multiple active calls
    const agentCallCounts = new Map<string, number>();
    for (const call of allCalls) {
      if (!call.agentId) continue;
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(call.state)) continue;
      agentCallCounts.set(call.agentId, (agentCallCounts.get(call.agentId) ?? 0) + 1);
    }
    for (const [agentId, count] of agentCallCounts) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });
});
