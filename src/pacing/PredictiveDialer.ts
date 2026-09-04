// ============================================================================
// SmartDialer — Predictive Dialer
// ============================================================================
// Uses answer rate history to predict how many calls to dial ahead of agent
// availability. This is the "smarter" dialing mode.
//
// Algorithm (Erlang-inspired pacing):
//   1. Calculate predicted answer rate from recent call history
//   2. Determine number of agents expected to become free soon
//   3. Calculate required overdial: calls_needed = free_agents / answer_rate
//   4. Apply Safety Controller veto for final approved number
//   5. Allocate and initiate calls
//
// Example:
//   - 10 agents available, answer rate = 50%
//   - Predictive: dial 10/0.5 = 20 calls (expect 10 to be answered)
//   - Safety Controller may reduce this to, say, 15 (overdial cap)
//
// The key difference from Progressive:
//   - Progressive: calls = agents (1:1)
//   - Predictive: calls = agents / answer_rate (overdial to keep agents busy)
// ============================================================================

import type { Database } from '../infrastructure/database.js';
import { AgentRepository } from '../domain/agent/AgentRepository.js';
import { CallRepository } from '../domain/call/CallRepository.js';
import { CallAllocator, type AllocationResult } from '../allocation/CallAllocator.js';
import { SafetyController } from '../safety/SafetyController.js';
import type { TelecomProvider } from '../provider/TelecomProvider.js';
import { logger } from '../common/logger.js';
import { SmartDialerConfig } from '../config.js';

export interface PredictiveTickResult {
  callsAttempted: number;
  callsSucceeded: number;
  callsFailed: number;
  availableAgents: number;
  predictedAnswerRate: number;
  rawPrediction: number;         // Before safety
  safetyApproved: number;        // After safety
  safetyReason: string;
  allocations: AllocationResult[];
}

export class PredictiveDialer {
  private readonly agentRepo: AgentRepository;
  private readonly callRepo: CallRepository;
  private readonly allocator: CallAllocator;
  private readonly safety: SafetyController;

  constructor(
    private readonly db: Database,
    private readonly config: SmartDialerConfig,
  ) {
    this.agentRepo = new AgentRepository(db);
    this.callRepo = new CallRepository(db);
    this.allocator = new CallAllocator(db, config);
    this.safety = new SafetyController(db, config);
  }

  /**
   * Execute one predictive dialing tick.
   *
   * Predictive formula:
   *   raw_calls = available_agents / predicted_answer_rate
   *   approved_calls = SafetyController.assess(raw_calls)
   */
  tick(campaignId: string, provider: TelecomProvider): PredictiveTickResult {
    // 1. Count available agents
    const availableAgents = this.agentRepo.countByState(campaignId, 'AVAILABLE');

    // 2. Calculate predicted answer rate
    const answerRate = this.calculateAnswerRate(campaignId);

    // 3. Calculate raw prediction (how many calls to dial)
    // Guard against division by zero and very low answer rates
    const clampedRate = Math.max(answerRate, this.config.pacing.minAnswerRate);
    const rawPrediction = Math.ceil(availableAgents / clampedRate);

    // 4. Subtract currently active (non-connected) calls
    const callCounts = this.callRepo.countActiveByStates(campaignId);
    const activePendingCalls =
      (callCounts['RESERVED'] ?? 0) +
      (callCounts['INITIATED'] ?? 0) +
      (callCounts['RINGING'] ?? 0);
    const newCallsNeeded = Math.max(0, rawPrediction - activePendingCalls);

    // 5. Safety Controller veto
    const assessment = this.safety.assess(campaignId, newCallsNeeded, provider);

    logger.info(`Predictive tick: ${availableAgents} available, rate=${(answerRate * 100).toFixed(1)}%, raw=${rawPrediction}, needed=${newCallsNeeded}, approved=${assessment.approved}`, {
      campaignId,
      component: 'PredictiveDialer',
    });

    if (assessment.approved === 0) {
      return {
        callsAttempted: 0,
        callsSucceeded: 0,
        callsFailed: 0,
        availableAgents,
        predictedAnswerRate: answerRate,
        rawPrediction,
        safetyApproved: 0,
        safetyReason: assessment.reason,
        allocations: [],
      };
    }

    // 6. Allocate and initiate calls
    const allocations: AllocationResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < assessment.approved; i++) {
      const result = this.allocator.allocateAndInitiate(campaignId, provider);
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

    logger.info(`Predictive tick complete: ${succeeded}/${assessment.approved} succeeded`, {
      campaignId,
      component: 'PredictiveDialer',
    });

    return {
      callsAttempted: allocations.length,
      callsSucceeded: succeeded,
      callsFailed: failed,
      availableAgents,
      predictedAnswerRate: answerRate,
      rawPrediction,
      safetyApproved: assessment.approved,
      safetyReason: assessment.reason,
      allocations,
    };
  }

  /**
   * Calculate the predicted answer rate from recent call history.
   *
   * Uses exponential moving average over a configurable window.
   * Falls back to default rate if insufficient data.
   */
  private calculateAnswerRate(campaignId: string): number {
    const stats = this.callRepo.getRecentCallStats(
      campaignId,
      this.config.pacing.answerRateWindow,
    );

    if (stats.total < this.config.pacing.minSampleSize) {
      // Insufficient data — use conservative default
      return this.config.pacing.defaultAnswerRate;
    }

    return stats.answered / stats.total;
  }
}
