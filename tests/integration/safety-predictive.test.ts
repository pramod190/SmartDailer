// ============================================================================
// Tests — Safety Controller + Predictive Dialer
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../helpers/testDb.js';
import { SafetyController } from '../../src/safety/SafetyController.js';
import { PredictiveDialer } from '../../src/pacing/PredictiveDialer.js';
import { ProviderEventHandler } from '../../src/events/ProviderEventHandler.js';
import { ReliableMockProvider } from '../../src/provider/ReliableMockProvider.js';
import { CampaignRepository } from '../../src/domain/campaign/CampaignRepository.js';
import { AgentRepository } from '../../src/domain/agent/AgentRepository.js';
import { BorrowerRepository } from '../../src/domain/borrower/BorrowerRepository.js';
import { CallRepository } from '../../src/domain/call/CallRepository.js';
import type { Database } from '../../src/infrastructure/database.js';
import { createConfig, type SmartDialerConfig } from '../../src/config.js';

describe('SafetyController', () => {
  let db: Database;
  let config: SmartDialerConfig;
  let safety: SafetyController;
  let campaigns: CampaignRepository;
  let agents: AgentRepository;
  let borrowers: BorrowerRepository;
  let campaignId: string;

  beforeEach(() => {
    db = createTestDatabase();
    config = createConfig();
    safety = new SafetyController(db, config);
    campaigns = new CampaignRepository(db);
    agents = new AgentRepository(db);
    borrowers = new BorrowerRepository(db);

    const c = campaigns.create('Safety Test', 'predictive');
    campaignId = c.id;
  });

  it('blocks all calls when no agents online', () => {
    const assessment = safety.assess(campaignId, 10);
    expect(assessment.approved).toBe(0);
    expect(assessment.reason).toContain('No agents online');
  });

  it('blocks all calls when provider is UNHEALTHY', () => {
    for (let i = 0; i < 5; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }

    const unhealthyProvider: any = {
      name: 'unhealthy',
      getHealthStatus: () => 'UNHEALTHY' as const,
    };

    const assessment = safety.assess(campaignId, 10, unhealthyProvider);
    expect(assessment.approved).toBe(0);
    expect(assessment.reason).toContain('UNHEALTHY');
  });

  it('reduces calls when provider is DEGRADED', () => {
    for (let i = 0; i < 10; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }

    const degradedProvider: any = {
      name: 'degraded',
      getHealthStatus: () => 'DEGRADED' as const,
    };

    const assessment = safety.assess(campaignId, 10, degradedProvider);
    // DEGRADED multiplier is 0.5
    expect(assessment.approved).toBeLessThan(10);
    expect(assessment.approved).toBeGreaterThan(0);
  });

  it('respects overdial ratio cap', () => {
    // With 5 agents and maxOverdialRatio=1.5 → max 7 calls
    for (let i = 0; i < 5; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }

    const assessment = safety.assess(campaignId, 20);
    // maxOverdialRatio=1.5 → max calls = 5 * 1.5 = 7
    expect(assessment.approved).toBeLessThanOrEqual(7);
  });

  it('approves calls when system is healthy', () => {
    for (let i = 0; i < 10; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }

    const healthyProvider: any = {
      name: 'healthy',
      getHealthStatus: () => 'HEALTHY' as const,
    };

    const assessment = safety.assess(campaignId, 5, healthyProvider);
    expect(assessment.approved).toBe(5);
  });

  it('isSafeToDialAny returns true when safe', () => {
    agents.create(campaignId, 'AVAILABLE');
    expect(safety.isSafeToDialAny(campaignId)).toBe(true);
  });

  it('isSafeToDialAny returns false when no agents', () => {
    expect(safety.isSafeToDialAny(campaignId)).toBe(false);
  });
});

describe('PredictiveDialer', () => {
  let db: Database;
  let config: SmartDialerConfig;
  let campaigns: CampaignRepository;
  let agents: AgentRepository;
  let borrowers: BorrowerRepository;
  let calls: CallRepository;
  let eventHandler: ProviderEventHandler;
  let campaignId: string;

  beforeEach(() => {
    db = createTestDatabase();
    config = createConfig({
      pacing: { safetyBuffer: 0, maxOverdialRatio: 2.0 },
    } as Partial<SmartDialerConfig>);
    campaigns = new CampaignRepository(db);
    agents = new AgentRepository(db);
    borrowers = new BorrowerRepository(db);
    calls = new CallRepository(db);
    eventHandler = new ProviderEventHandler(db, config);

    const c = campaigns.create('Predictive Test', 'predictive');
    campaignId = c.id;
  });

  it('dials more calls than progressive when answer rate is low', () => {
    // 5 agents, 50% answer rate → should dial ~10 calls (5/0.5)
    for (let i = 0; i < 5; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }
    for (let i = 0; i < 20; i++) {
      borrowers.create(campaignId, `555-${i.toString().padStart(4, '0')}`);
    }

    const provider = new ReliableMockProvider({ answerRate: 0.5, failureRate: 0 }, 42);
    const dialer = new PredictiveDialer(db, config);

    const result = dialer.tick(campaignId, provider);

    // With default answer rate (0.5) and 5 agents:
    // raw = ceil(5/0.5) = 10, but safety may cap it
    expect(result.rawPrediction).toBe(10);
    expect(result.callsSucceeded).toBeGreaterThan(0);
    // Predictive should dial more than progressive (which would only dial 5)
    expect(result.rawPrediction).toBeGreaterThan(5);
  });

  it('end-to-end: predictive tick + event processing', () => {
    for (let i = 0; i < 5; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }
    for (let i = 0; i < 30; i++) {
      borrowers.create(campaignId, `555-${i.toString().padStart(4, '0')}`);
    }

    const provider = new ReliableMockProvider({ answerRate: 1.0, failureRate: 0 }, 42);
    const dialer = new PredictiveDialer(db, config);

    // Tick 1
    const result = dialer.tick(campaignId, provider);
    expect(result.callsSucceeded).toBeGreaterThan(0);

    // Process events
    const events = provider.drainEvents();
    for (const event of events) {
      eventHandler.processEvent(event);
    }

    // After processing, all calls should be terminal
    const allCalls = calls.findByCampaign(campaignId);
    const terminalCalls = allCalls.filter(c =>
      ['COMPLETED', 'FAILED', 'CANCELLED'].includes(c.state),
    );
    expect(terminalCalls.length).toBe(allCalls.length);
  });

  it('safety controller reduces calls when overdial ratio exceeded', () => {
    const restrictiveConfig = createConfig({
      pacing: { safetyBuffer: 0, maxOverdialRatio: 1.0 },
    } as Partial<SmartDialerConfig>);

    for (let i = 0; i < 3; i++) {
      agents.create(campaignId, 'AVAILABLE');
    }
    for (let i = 0; i < 20; i++) {
      borrowers.create(campaignId, `555-${i.toString().padStart(4, '0')}`);
    }

    const provider = new ReliableMockProvider({ answerRate: 0.5, failureRate: 0 }, 42);
    const dialer = new PredictiveDialer(db, restrictiveConfig);

    const result = dialer.tick(campaignId, provider);

    // maxOverdialRatio=1.0 → max calls = 3 * 1.0 = 3
    // raw prediction = ceil(3/0.5) = 6, but safety caps to 3
    expect(result.rawPrediction).toBe(6);
    expect(result.callsSucceeded).toBeLessThanOrEqual(3);
  });
});
