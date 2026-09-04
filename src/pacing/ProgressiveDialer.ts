// ============================================================================
// SmartDialer — Progressive Dialer
// ============================================================================
// Rule: If there are N safely available agents, the maximum number of
// outbound agent-bound calls is N. No overdial.
//
// Flow:
// 1. Find safely available agents
// 2. Determine capacity (available - safetyBuffer)
// 3. Select borrowers
// 4. Reserve agents atomically (via CallAllocator)
// 5. Initiate calls via provider
// 6. Handle failures (release resources)
//
// This is the conservative dialing strategy that guarantees:
//   agent-bound calls <= safely allocated agents
// ============================================================================

import type { Database } from '../infrastructure/database.js';
import { AgentRepository } from '../domain/agent/AgentRepository.js';
import { CallRepository } from '../domain/call/CallRepository.js';
import { CallAllocator, type AllocationResult } from '../allocation/CallAllocator.js';
import type { TelecomProvider } from '../provider/TelecomProvider.js';
import { logger } from '../common/logger.js';
import { SmartDialerConfig } from '../config.js';

export interface DialerTickResult {
  callsAttempted: number;
  callsSucceeded: number;
  callsFailed: number;
  availableAgents: number;
  safeCapacity: number;
  allocations: AllocationResult[];
}

export class ProgressiveDialer {
  private readonly agentRepo: AgentRepository;
  private readonly callRepo: CallRepository;
  private readonly allocator: CallAllocator;

  constructor(
    private readonly db: Database,
    private readonly config: SmartDialerConfig,
  ) {
    this.agentRepo = new AgentRepository(db);
    this.callRepo = new CallRepository(db);
    this.allocator = new CallAllocator(db, config);
  }

  /**
   * Execute one dialing tick for a campaign.
   *
   * Progressive rule: available agents - safetyBuffer = max new calls.
   * Each call is allocated atomically: reserve agent → reserve borrower →
   * create call → initiate via provider.
   */
  tick(campaignId: string, provider: TelecomProvider): DialerTickResult {
    // 1. Count available agents
    const availableAgents = this.agentRepo.countByState(campaignId, 'AVAILABLE');

    // 2. Calculate safe capacity
    // Subtract safety buffer to keep some agents free
    const safeCapacity = Math.max(0, availableAgents - this.config.pacing.safetyBuffer);

    // 3. Also subtract currently active calls (agents in RESERVED/DIALING/CONNECTED)
    const callCounts = this.callRepo.countActiveByStates(campaignId);
    const activeCalls =
      (callCounts['RESERVED'] ?? 0) +
      (callCounts['INITIATED'] ?? 0) +
      (callCounts['RINGING'] ?? 0);

    // Progressive rule: new calls = safeCapacity - active non-connected calls
    // (Connected calls already have agents, so they don't reduce new capacity)
    const maxNewCalls = Math.max(0, safeCapacity - activeCalls);

    logger.info(`Progressive tick: ${availableAgents} available, ${safeCapacity} safe capacity, ${activeCalls} active, ${maxNewCalls} new calls`, {
      campaignId,
      component: 'ProgressiveDialer',
    });

    if (maxNewCalls === 0) {
      return {
        callsAttempted: 0,
        callsSucceeded: 0,
        callsFailed: 0,
        availableAgents,
        safeCapacity,
        allocations: [],
      };
    }

    // 4. Allocate and initiate calls (one at a time for progressive)
    const allocations: AllocationResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < maxNewCalls; i++) {
      const result = this.allocator.allocateAndInitiate(campaignId, provider);
      allocations.push(result);

      if (result.success) {
        succeeded++;
      } else {
        failed++;
        // If we can't allocate, stop trying (no more agents or borrowers)
        if (result.failureReason?.includes('No available agents or borrowers')) {
          break;
        }
      }
    }

    logger.info(`Progressive tick complete: ${succeeded} succeeded, ${failed} failed`, {
      campaignId,
      component: 'ProgressiveDialer',
    });

    return {
      callsAttempted: allocations.length,
      callsSucceeded: succeeded,
      callsFailed: failed,
      availableAgents,
      safeCapacity,
      allocations,
    };
  }

  /**
   * Execute a tick without provider calls (for testing allocation logic).
   */
  tickAllocateOnly(campaignId: string): DialerTickResult {
    const availableAgents = this.agentRepo.countByState(campaignId, 'AVAILABLE');
    const safeCapacity = Math.max(0, availableAgents - this.config.pacing.safetyBuffer);

    const callCounts = this.callRepo.countActiveByStates(campaignId);
    const activeCalls =
      (callCounts['RESERVED'] ?? 0) +
      (callCounts['INITIATED'] ?? 0) +
      (callCounts['RINGING'] ?? 0);

    const maxNewCalls = Math.max(0, safeCapacity - activeCalls);

    const allocations: AllocationResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < maxNewCalls; i++) {
      const result = this.allocator.allocateOnly(campaignId);
      allocations.push(result);

      if (result.success) {
        succeeded++;
      } else {
        failed++;
        if (result.failureReason?.includes('No available agents or borrowers')) {
          break;
        }
      }
    }

    return {
      callsAttempted: allocations.length,
      callsSucceeded: succeeded,
      callsFailed: failed,
      availableAgents,
      safeCapacity,
      allocations,
    };
  }
}
