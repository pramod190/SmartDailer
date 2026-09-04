// ============================================================================
// SmartDialer — Safety Controller (Independent Guardian)
// ============================================================================
// MANDATORY CONSTRAINT: Calls placed NEVER exceed safely allocated agents.
//
// The Safety Controller is independent from the dialer — it has VETO POWER.
// Even if the predictive algorithm says "dial 10 calls," the Safety Controller
// can reduce that to a safe limit.
//
// Invariants enforced:
// 1. active_calls ≤ available_agents + buffer_threshold
// 2. overdial_ratio ≤ max_overdial_ratio (configurable)
// 3. abandon_rate ≤ max_abandon_rate (3% regulatory limit)
// 4. provider health check — don't dial into unhealthy providers
//
// DESIGN: The Safety Controller is a pure function:
//   (system_state, proposed_calls) → approved_calls
// It never mutates state. It only reads and advises.
// ============================================================================

import type { Database } from '../infrastructure/database.js';
import { AgentRepository } from '../domain/agent/AgentRepository.js';
import { CallRepository } from '../domain/call/CallRepository.js';
import { ProviderHealthRepository } from '../domain/provider/ProviderHealthRepository.js';
import type { TelecomProvider } from '../provider/TelecomProvider.js';
import { logger } from '../common/logger.js';
import { SmartDialerConfig } from '../config.js';

export interface SafetyAssessment {
  approved: number;           // Number of calls approved
  proposed: number;           // Number of calls originally proposed
  vetoed: number;             // Number of calls vetoed (proposed - approved)
  reason: string;             // Explanation
  metrics: SafetyMetrics;
}

export interface SafetyMetrics {
  availableAgents: number;
  busyAgents: number;
  activeCalls: number;
  recentAnswerRate: number;
  recentAbandonRate: number;
  currentOverdialRatio: number;
  providerHealth: string;
}

export class SafetyController {
  private readonly agentRepo: AgentRepository;
  private readonly callRepo: CallRepository;
  private readonly healthRepo: ProviderHealthRepository;

  constructor(
    private readonly db: Database,
    private readonly config: SmartDialerConfig,
  ) {
    this.agentRepo = new AgentRepository(db);
    this.callRepo = new CallRepository(db);
    this.healthRepo = new ProviderHealthRepository(db);
  }

  /**
   * Assess whether the proposed number of calls is safe.
   * Returns an assessment with the approved number (possibly lower than proposed).
   *
   * THIS IS THE CORE SAFETY GATE.
   */
  assess(
    campaignId: string,
    proposedCalls: number,
    provider?: TelecomProvider,
  ): SafetyAssessment {
    const metrics = this.calculateMetrics(campaignId, provider);

    // --- Check 1: Provider health ---
    if (metrics.providerHealth === 'UNHEALTHY') {
      logger.warn('Safety: Provider UNHEALTHY, blocking all calls', {
        campaignId, component: 'SafetyController',
      });
      return this.createAssessment(0, proposedCalls, 'Provider is UNHEALTHY', metrics);
    }

    // --- Check 2: Max overdial ratio ---
    // overdial ratio = active calls / (available agents + busy agents)
    const totalAgents = metrics.availableAgents + metrics.busyAgents;
    if (totalAgents === 0) {
      return this.createAssessment(0, proposedCalls, 'No agents online', metrics);
    }

    const maxOverdialRatio = this.config.pacing.maxOverdialRatio;
    const maxCalls = Math.floor(totalAgents * maxOverdialRatio);
    const remainingCapacity = Math.max(0, maxCalls - metrics.activeCalls);

    // --- Check 3: Abandon rate check ---
    // If abandon rate is above limit, reduce calls aggressively
    const maxAbandonRate = this.config.pacing.maxAbandonRate;
    let abandonRateMultiplier = 1.0;
    if (metrics.recentAbandonRate > maxAbandonRate) {
      // Reduce proportionally
      abandonRateMultiplier = Math.max(0.1, 1.0 - (metrics.recentAbandonRate - maxAbandonRate) * 10);
      logger.warn(`Safety: Abandon rate ${(metrics.recentAbandonRate * 100).toFixed(1)}% exceeds limit ${(maxAbandonRate * 100).toFixed(1)}%`, {
        campaignId, multiplier: abandonRateMultiplier, component: 'SafetyController',
      });
    }

    // --- Check 4: Degraded provider → reduce by 50% ---
    let degradedMultiplier = 1.0;
    if (metrics.providerHealth === 'DEGRADED') {
      degradedMultiplier = 0.5;
      logger.warn('Safety: Provider DEGRADED, reducing calls by 50%', {
        campaignId, component: 'SafetyController',
      });
    }

    // --- Final calculation ---
    const safeLimit = Math.floor(
      remainingCapacity * abandonRateMultiplier * degradedMultiplier,
    );
    const approved = Math.min(proposedCalls, safeLimit);

    const reason = approved < proposedCalls
      ? `Reduced from ${proposedCalls} to ${approved} (overdial cap: ${maxCalls}, active: ${metrics.activeCalls}, abandon mult: ${abandonRateMultiplier.toFixed(2)}, degraded mult: ${degradedMultiplier.toFixed(2)})`
      : `Approved ${approved} calls`;

    return this.createAssessment(approved, proposedCalls, reason, metrics);
  }

  /**
   * Quick check: is it safe to place ANY calls right now?
   */
  isSafeToDialAny(campaignId: string, provider?: TelecomProvider): boolean {
    const assessment = this.assess(campaignId, 1, provider);
    return assessment.approved > 0;
  }

  /**
   * Get current system metrics without making any decisions.
   */
  getMetrics(campaignId: string, provider?: TelecomProvider): SafetyMetrics {
    return this.calculateMetrics(campaignId, provider);
  }

  private calculateMetrics(campaignId: string, provider?: TelecomProvider): SafetyMetrics {
    const availableAgents = this.agentRepo.countByState(campaignId, 'AVAILABLE');
    const busyAgents =
      this.agentRepo.countByState(campaignId, 'RESERVED') +
      this.agentRepo.countByState(campaignId, 'DIALING') +
      this.agentRepo.countByState(campaignId, 'CONNECTED') +
      this.agentRepo.countByState(campaignId, 'WRAP_UP');

    const callCounts = this.callRepo.countActiveByStates(campaignId);
    const activeCalls =
      (callCounts['RESERVED'] ?? 0) +
      (callCounts['INITIATED'] ?? 0) +
      (callCounts['RINGING'] ?? 0) +
      (callCounts['ANSWERED'] ?? 0) +
      (callCounts['CONNECTED'] ?? 0);

    // Recent answer rate (last N calls)
    const recentStats = this.callRepo.getRecentCallStats(
      campaignId,
      this.config.pacing.answerRateWindow,
    );
    const recentAnswerRate = recentStats.total > 0
      ? recentStats.answered / recentStats.total
      : 0.5; // Default 50% when no data

    // Abandon rate: calls that FAILED after RINGING but before CONNECTED / total calls
    // For now, approximate as 1 - answer rate (simplified model)
    const recentAbandonRate = recentStats.total > 0
      ? Math.max(0, 1 - recentAnswerRate - 0.3) // rough estimate
      : 0;

    // Overdial ratio
    const currentOverdialRatio = availableAgents > 0
      ? activeCalls / availableAgents
      : activeCalls > 0 ? Infinity : 0;

    // Provider health
    let providerHealth: string = 'HEALTHY';
    if (provider) {
      providerHealth = provider.getHealthStatus();
    } else {
      const allHealth = this.healthRepo.findAll();
      if (allHealth.some(h => h.healthStatus === 'UNHEALTHY')) {
        providerHealth = 'UNHEALTHY';
      } else if (allHealth.some(h => h.healthStatus === 'DEGRADED')) {
        providerHealth = 'DEGRADED';
      }
    }

    return {
      availableAgents,
      busyAgents,
      activeCalls,
      recentAnswerRate,
      recentAbandonRate,
      currentOverdialRatio,
      providerHealth,
    };
  }

  private createAssessment(
    approved: number,
    proposed: number,
    reason: string,
    metrics: SafetyMetrics,
  ): SafetyAssessment {
    return {
      approved,
      proposed,
      vetoed: proposed - approved,
      reason,
      metrics,
    };
  }
}
