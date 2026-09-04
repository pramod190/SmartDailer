// ============================================================================
// SmartDialer — Provider Outage Handler
// ============================================================================
// Detects provider outages and manages degraded operation modes:
//   - HEALTHY: Normal predictive or progressive dialing
//   - DEGRADED: Automatically forces progressive mode (overdial disallowed)
//   - UNHEALTHY: Halts all dialing, prevents wasting borrower attempts
// ============================================================================

import type { Database } from '../infrastructure/database.js';
import { ProviderHealthRepository } from '../domain/provider/ProviderHealthRepository.js';
import type { HealthStatus } from '../domain/provider/ProviderHealth.js';
import type { SmartDialerConfig } from '../config.js';
import { logger } from '../common/logger.js';

export interface OutageAction {
  status: HealthStatus;
  allowDialing: boolean;
  forceProgressive: boolean;
  reason: string;
}

export class ProviderOutageHandler {
  private readonly healthRepo: ProviderHealthRepository;

  constructor(
    private readonly db: Database,
    private readonly config: SmartDialerConfig,
  ) {
    this.healthRepo = new ProviderHealthRepository(db);
  }

  /**
   * Assess the operational status of a provider and recommend actions.
   */
  assessProvider(providerName: string): OutageAction {
    const health = this.healthRepo.findByName(providerName);
    if (!health) {
      return {
        status: 'HEALTHY',
        allowDialing: true,
        forceProgressive: false,
        reason: 'Provider has no history, assumed healthy',
      };
    }

    if (health.healthStatus === 'UNHEALTHY') {
      logger.warn(`Provider ${providerName} is UNHEALTHY. Dialing halted.`, {
        consecutiveFailures: health.consecutiveFailures,
        component: 'ProviderOutageHandler',
      });
      return {
        status: 'UNHEALTHY',
        allowDialing: false,
        forceProgressive: true,
        reason: `Provider ${providerName} is UNHEALTHY (${health.consecutiveFailures} consecutive failures). Dialing halted.`,
      };
    }

    if (health.healthStatus === 'DEGRADED') {
      logger.warn(`Provider ${providerName} is DEGRADED. Forcing progressive pacing.`, {
        component: 'ProviderOutageHandler',
      });
      return {
        status: 'DEGRADED',
        allowDialing: true,
        forceProgressive: true,
        reason: `Provider ${providerName} is DEGRADED. Predictive pacing suspended to avoid call drops.`,
      };
    }

    return {
      status: 'HEALTHY',
      allowDialing: true,
      forceProgressive: false,
      reason: `Provider ${providerName} is healthy.`,
    };
  }
}
