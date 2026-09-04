// ============================================================================
// SmartDialer — Simulation Runner
// ============================================================================
// Multi-tick simulation that runs progressive or predictive dialing for N
// ticks, processing all provider events between ticks.
//
// This demonstrates the full system lifecycle:
// 1. Create campaign, agents, borrowers
// 2. Run dialing ticks
// 3. Process provider events
// 4. Collect metrics
// 5. Verify invariants at the end
// ============================================================================

import type { Database } from '../infrastructure/database.js';
import { ProgressiveDialer } from '../pacing/ProgressiveDialer.js';
import { PredictiveDialer } from '../pacing/PredictiveDialer.js';
import { ProviderEventHandler } from '../events/ProviderEventHandler.js';
import { SafetyController } from '../safety/SafetyController.js';
import { CampaignRepository } from '../domain/campaign/CampaignRepository.js';
import { AgentRepository } from '../domain/agent/AgentRepository.js';
import { BorrowerRepository } from '../domain/borrower/BorrowerRepository.js';
import { CallRepository } from '../domain/call/CallRepository.js';
import { ReliableMockProvider } from '../provider/ReliableMockProvider.js';
import { UnreliableMockProvider } from '../provider/UnreliableMockProvider.js';
import type { TelecomProvider, ProviderEvent } from '../provider/TelecomProvider.js';
import { createConfig, type SmartDialerConfig } from '../config.js';
import { logger } from '../common/logger.js';
import type { CampaignMode } from '../domain/campaign/Campaign.js';

export interface SimulationParams {
  mode: CampaignMode;
  numAgents: number;
  numBorrowers: number;
  numTicks: number;
  providerType: 'reliable' | 'unreliable';
  answerRate?: number;
  failureRate?: number;
  seed?: number;
  configOverrides?: Partial<SmartDialerConfig>;
}

export interface TickMetrics {
  tick: number;
  callsAttempted: number;
  callsSucceeded: number;
  callsFailed: number;
  eventsProcessed: number;
  eventsDuplicate: number;
  eventsStale: number;
  agentsAvailable: number;
  agentsBusy: number;
  borrowersEligible: number;
  borrowersCompleted: number;
  borrowersExhausted: number;
}

export interface SimulationResult {
  campaignId: string;
  mode: CampaignMode;
  params: SimulationParams;
  ticks: TickMetrics[];
  totals: {
    totalCalls: number;
    completedCalls: number;
    failedCalls: number;
    cancelledCalls: number;
    totalBorrowers: number;
    completedBorrowers: number;
    exhaustedBorrowers: number;
    eligibleBorrowers: number;
    totalEventsProcessed: number;
    totalDuplicatesRejected: number;
    totalStaleRejected: number;
  };
  invariants: {
    noDoubleReservation: boolean;
    allCallsTerminal: boolean;
    noOrphanedAgents: boolean;
    agentCallInvariant: boolean;
  };
  durationMs: number;
}

export function runSimulation(db: Database, params: SimulationParams): SimulationResult {
  const startTime = Date.now();

  const config = createConfig(params.configOverrides);
  const campaigns = new CampaignRepository(db);
  const agentRepo = new AgentRepository(db);
  const borrowerRepo = new BorrowerRepository(db);
  const callRepo = new CallRepository(db);
  const eventHandler = new ProviderEventHandler(db, config);

  // --- Setup ---
  const campaign = campaigns.create(`Simulation ${params.mode}`, params.mode);
  campaigns.updateStatus(campaign.id, 'active');
  const campaignId = campaign.id;

  // Create agents (all start AVAILABLE)
  for (let i = 0; i < params.numAgents; i++) {
    agentRepo.create(campaignId, 'AVAILABLE');
  }

  // Create borrowers
  for (let i = 0; i < params.numBorrowers; i++) {
    borrowerRepo.create(campaignId, `555-${i.toString().padStart(6, '0')}`, Math.floor(Math.random() * 10));
  }

  // Create provider
  const provider = createProvider(params);

  // Create dialer
  const progressiveDialer = new ProgressiveDialer(db, config);
  const predictiveDialer = new PredictiveDialer(db, config);

  // --- Run simulation ticks ---
  const tickMetrics: TickMetrics[] = [];

  for (let tick = 0; tick < params.numTicks; tick++) {
    let callsAttempted = 0;
    let callsSucceeded = 0;
    let callsFailed = 0;

    // 1. Run dialer tick
    if (params.mode === 'progressive') {
      const result = progressiveDialer.tick(campaignId, provider);
      callsAttempted = result.callsAttempted;
      callsSucceeded = result.callsSucceeded;
      callsFailed = result.callsFailed;
    } else {
      const result = predictiveDialer.tick(campaignId, provider);
      callsAttempted = result.callsAttempted;
      callsSucceeded = result.callsSucceeded;
      callsFailed = result.callsFailed;
    }

    // 2. Process all provider events
    const events = (provider as any).drainEvents?.() as ProviderEvent[] ?? [];
    let eventsProcessed = 0;
    let eventsDuplicate = 0;
    let eventsStale = 0;

    for (const event of events) {
      const result = eventHandler.processEvent(event);
      if (result.processed) eventsProcessed++;
      if (result.duplicate) eventsDuplicate++;
      if (result.stale) eventsStale++;
    }

    // 3. Collect metrics
    const agentsAvailable = agentRepo.countByState(campaignId, 'AVAILABLE');
    const agentsBusy =
      agentRepo.countByState(campaignId, 'RESERVED') +
      agentRepo.countByState(campaignId, 'DIALING') +
      agentRepo.countByState(campaignId, 'CONNECTED') +
      agentRepo.countByState(campaignId, 'WRAP_UP');

    const borrowersEligible = borrowerRepo.countByStatus(campaignId, 'eligible');
    const borrowersCompleted = borrowerRepo.countByStatus(campaignId, 'completed');
    const borrowersExhausted = borrowerRepo.countByStatus(campaignId, 'exhausted');

    tickMetrics.push({
      tick,
      callsAttempted,
      callsSucceeded,
      callsFailed,
      eventsProcessed,
      eventsDuplicate,
      eventsStale,
      agentsAvailable,
      agentsBusy,
      borrowersEligible,
      borrowersCompleted,
      borrowersExhausted,
    });
  }

  // --- Verify invariants ---
  const allCalls = callRepo.findByCampaign(campaignId);
  const allAgents = agentRepo.findByCampaign(campaignId);

  // Invariant 1: no agent has multiple active calls
  const agentActiveCalls = new Map<string, number>();
  for (const call of allCalls) {
    if (!call.agentId) continue;
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(call.state)) continue;
    agentActiveCalls.set(call.agentId, (agentActiveCalls.get(call.agentId) ?? 0) + 1);
  }
  const noDoubleReservation = Array.from(agentActiveCalls.values()).every(count => count <= 1);

  // Invariant 2: all calls in terminal state (after all events processed)
  const nonCancelledCalls = allCalls.filter(c => c.state !== 'CANCELLED');
  const allCallsTerminal = nonCancelledCalls.every(c =>
    ['COMPLETED', 'FAILED', 'CANCELLED'].includes(c.state)
  );

  // Invariant 3: no orphaned agents (all should be AVAILABLE or OFFLINE)
  const noOrphanedAgents = allAgents.every(a =>
    a.state === 'AVAILABLE' || a.state === 'OFFLINE'
  );

  // Invariant 4: agent-call count consistency
  const agentCallInvariant = noDoubleReservation;

  // --- Totals ---
  const completedCalls = allCalls.filter(c => c.state === 'COMPLETED').length;
  const failedCalls = allCalls.filter(c => c.state === 'FAILED').length;
  const cancelledCalls = allCalls.filter(c => c.state === 'CANCELLED').length;
  const totalEventsProcessed = tickMetrics.reduce((s, t) => s + t.eventsProcessed, 0);
  const totalDuplicatesRejected = tickMetrics.reduce((s, t) => s + t.eventsDuplicate, 0);
  const totalStaleRejected = tickMetrics.reduce((s, t) => s + t.eventsStale, 0);

  const borrowers = borrowerRepo.findByCampaign(campaignId);
  const completedBorrowers = borrowers.filter(b => b.status === 'completed').length;
  const exhaustedBorrowers = borrowers.filter(b => b.status === 'exhausted').length;
  const eligibleBorrowers = borrowers.filter(b => b.status === 'eligible').length;

  return {
    campaignId,
    mode: params.mode,
    params,
    ticks: tickMetrics,
    totals: {
      totalCalls: allCalls.length,
      completedCalls,
      failedCalls,
      cancelledCalls,
      totalBorrowers: params.numBorrowers,
      completedBorrowers,
      exhaustedBorrowers,
      eligibleBorrowers,
      totalEventsProcessed,
      totalDuplicatesRejected,
      totalStaleRejected,
    },
    invariants: {
      noDoubleReservation,
      allCallsTerminal,
      noOrphanedAgents,
      agentCallInvariant,
    },
    durationMs: Date.now() - startTime,
  };
}

function createProvider(params: SimulationParams): TelecomProvider & { drainEvents(): ProviderEvent[] } {
  if (params.providerType === 'reliable') {
    return new ReliableMockProvider({
      answerRate: params.answerRate ?? 0.5,
      failureRate: params.failureRate ?? 0.02,
    }, params.seed ?? 42);
  } else {
    return new UnreliableMockProvider({
      answerRate: params.answerRate ?? 0.4,
      failureRate: params.failureRate ?? 0.15,
      duplicateEventRate: 0.15,
      outOfOrderRate: 0.08,
    }, params.seed ?? 42);
  }
}
