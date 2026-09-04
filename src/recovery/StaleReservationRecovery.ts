// ============================================================================
// SmartDialer — Stale Reservation Recovery
// ============================================================================
// Detects and reclaims agent reservations and call allocations that were
// abandoned due to worker crashes, network partitions, or lost provider calls.
//
// In a distributed system:
//   - Worker A reserves Agent 1 and Call 1
//   - Worker A crashes or loses network before completing provider initiation
//   - Agent 1 remains RESERVED indefinitely unless reclaimed
//
// StaleReservationRecovery enforces a lease timeout:
//   - Finds agents where state='RESERVED' AND reserved_at < now - leaseTimeout
//   - Releases the agent back to AVAILABLE (using optimistic locking)
//   - Fails the associated call with 'stale_reservation_timeout'
//   - Releases or exhausts the borrower so they don't remain locked
// ============================================================================

import type { Database } from '../infrastructure/database.js';
import { withTransaction } from '../infrastructure/database.js';
import { AgentRepository } from '../domain/agent/AgentRepository.js';
import { CallRepository } from '../domain/call/CallRepository.js';
import { BorrowerRepository } from '../domain/borrower/BorrowerRepository.js';
import { logger } from '../common/logger.js';
import type { SmartDialerConfig } from '../config.js';

export interface RecoverySummary {
  agentsReclaimed: number;
  callsFailed: number;
  borrowersReleased: number;
  borrowersExhausted: number;
}

export class StaleReservationRecovery {
  private readonly agentRepo: AgentRepository;
  private readonly callRepo: CallRepository;
  private readonly borrowerRepo: BorrowerRepository;

  constructor(
    private readonly db: Database,
    private readonly config: SmartDialerConfig,
  ) {
    this.agentRepo = new AgentRepository(db);
    this.callRepo = new CallRepository(db);
    this.borrowerRepo = new BorrowerRepository(db);
  }

  /**
   * Scan for and recover all stale agent reservations.
   * Safe to run periodically from a background timer or before dialing ticks.
   */
  recoverStaleReservations(campaignId?: string): RecoverySummary {
    const leaseSec = this.config.recovery.leaseTimeoutSec;
    const staleAgents = this.agentRepo.findStaleReservations(leaseSec);

    const filtered = campaignId
      ? staleAgents.filter(a => a.campaignId === campaignId)
      : staleAgents;

    let agentsReclaimed = 0;
    let callsFailed = 0;
    let borrowersReleased = 0;
    let borrowersExhausted = 0;

    for (const agent of filtered) {
      const recovered = withTransaction(this.db, () => {
        // 1. Re-check agent state with optimistic lock
        const currentAgent = this.agentRepo.findById(agent.id);
        if (!currentAgent || currentAgent.state !== 'RESERVED' || currentAgent.version !== agent.version) {
          return false; // Already transitioned by another process
        }

        // Release the agent
        const released = this.agentRepo.releaseStaleReservation(agent.id, currentAgent.version);
        if (!released) return false;

        // 2. If there was an associated call, fail it
        if (currentAgent.currentCallId) {
          const call = this.callRepo.findById(currentAgent.currentCallId);
          if (call && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(call.state)) {
            this.callRepo.transitionState(call.id, 'FAILED', call.version, {
              failureReason: 'stale_reservation_timeout',
            });
            callsFailed++;

            // 3. Clean up borrower
            const borrower = this.borrowerRepo.findById(call.borrowerId);
            if (borrower && borrower.status === 'allocated') {
              if (borrower.attemptCount >= this.config.provider.retryMaxAttempts) {
                this.borrowerRepo.exhaust(borrower.id);
                borrowersExhausted++;
              } else {
                const backoffMs = Math.min(
                  this.config.provider.retryBackoffBaseMs * Math.pow(2, borrower.attemptCount - 1),
                  this.config.provider.retryBackoffMaxMs,
                );
                const nextEligibleAt = new Date(Date.now() + backoffMs).toISOString();
                this.borrowerRepo.release(borrower.id, nextEligibleAt);
                borrowersReleased++;
              }
            }
          }
        }

        return true;
      });

      if (recovered) {
        agentsReclaimed++;
        logger.warn('Stale reservation reclaimed', {
          agentId: agent.id,
          campaignId: agent.campaignId,
          component: 'StaleReservationRecovery',
        });
      }
    }

    return {
      agentsReclaimed,
      callsFailed,
      borrowersReleased,
      borrowersExhausted,
    };
  }
}
