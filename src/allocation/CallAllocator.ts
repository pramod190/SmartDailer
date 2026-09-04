// ============================================================================
// SmartDialer — Call Allocator
// ============================================================================
// Responsible for the atomic sequence:
//   1. Reserve agent (optimistic lock)
//   2. Allocate borrower (optimistic lock)
//   3. Create call record
//   4. Initiate call via provider
//   5. Handle failure (release resources)
//
// CRITICAL DESIGN: Steps 1-3 happen inside a database transaction.
// Step 4 (provider call) happens OUTSIDE the transaction because we cannot
// hold a DB transaction open while waiting on an external network call.
//
// If step 4 fails, we release the agent and borrower within a new transaction.
// This is the fundamental distributed systems boundary.
//
// Concurrency safety:
// - Agent reservation uses UPDATE ... WHERE version = ? → only 1 worker wins
// - Borrower allocation uses UPDATE ... WHERE version = ? → only 1 worker wins
// - If either fails, the entire allocation is rolled back
// ============================================================================

import type { Database } from '../infrastructure/database.js';
import { withTransaction } from '../infrastructure/database.js';
import { AgentRepository } from '../domain/agent/AgentRepository.js';
import { BorrowerRepository } from '../domain/borrower/BorrowerRepository.js';
import { CallRepository } from '../domain/call/CallRepository.js';
import type { Agent } from '../domain/agent/AgentState.js';
import type { Borrower } from '../domain/borrower/Borrower.js';
import type { Call } from '../domain/call/CallState.js';
import type { TelecomProvider, InitiateCallResponse } from '../provider/TelecomProvider.js';
import { logger } from '../common/logger.js';
import { SmartDialerConfig } from '../config.js';

export interface AllocationResult {
  success: boolean;
  call?: Call;
  agent?: Agent;
  borrower?: Borrower;
  failureReason?: string;
}

export class CallAllocator {
  private readonly agentRepo: AgentRepository;
  private readonly borrowerRepo: BorrowerRepository;
  private readonly callRepo: CallRepository;

  constructor(
    private readonly db: Database,
    private readonly config: SmartDialerConfig,
  ) {
    this.agentRepo = new AgentRepository(db);
    this.borrowerRepo = new BorrowerRepository(db);
    this.callRepo = new CallRepository(db);
  }

  /**
   * Attempt to allocate a single call: reserve an agent, allocate a borrower,
   * create a call, and initiate via provider.
   *
   * This is the core allocation path used by both progressive and predictive dialers.
   */
  allocateAndInitiate(
    campaignId: string,
    provider: TelecomProvider,
  ): AllocationResult {
    // ----- PHASE 1: Database transaction (agent + borrower + call) -----
    let reserved: { agent: Agent; borrower: Borrower; call: Call } | null = null;

    try {
      reserved = withTransaction(this.db, () => {
        // 1. Find an available agent
        const availableAgents = this.agentRepo.findAvailableByCampaign(campaignId);
        if (availableAgents.length === 0) {
          return null;  // No agents available
        }

        // Try each available agent (in case of concurrent conflicts)
        for (const candidateAgent of availableAgents) {
          // 2. Select next eligible borrower
          const borrower = this.borrowerRepo.selectNextEligible(campaignId);
          if (!borrower) {
            return null;  // No eligible borrowers
          }

          // 3. Reserve agent (optimistic lock)
          // CREATE CALL FIRST so we have the call ID for the agent's current_call_id
          const call = this.callRepo.create({
            campaignId,
            agentId: candidateAgent.id,
            borrowerId: borrower.id,
            attemptNumber: borrower.attemptCount + 1,
          });

          const agentReserved = this.agentRepo.reserveAgent(
            candidateAgent.id,
            call.id,
            candidateAgent.version,
          );

          if (!agentReserved) {
            // Another worker beat us — try next agent
            // Mark the call as cancelled since agent reservation failed
            this.callRepo.transitionState(call.id, 'CANCELLED', call.version, {
              failureReason: 'Agent reservation conflict',
            });
            continue;
          }

          // 4. Allocate borrower (optimistic lock)
          const borrowerAllocated = this.borrowerRepo.allocate(borrower.id, borrower.version);
          if (!borrowerAllocated) {
            // Borrower conflict — release agent and try again
            this.agentRepo.releaseStaleReservation(candidateAgent.id, candidateAgent.version + 1);
            this.callRepo.transitionState(call.id, 'CANCELLED', call.version, {
              failureReason: 'Borrower allocation conflict',
            });
            continue;
          }

          // 5. Transition call to RESERVED
          this.callRepo.transitionState(call.id, 'RESERVED', call.version);

          const updatedCall = this.callRepo.findById(call.id)!;
          const updatedAgent = this.agentRepo.findById(candidateAgent.id)!;

          logger.info('Call allocated successfully', {
            campaignId,
            agentId: updatedAgent.id,
            borrowerId: borrower.id,
            callId: updatedCall.id,
            component: 'CallAllocator',
          });

          return { agent: updatedAgent, borrower, call: updatedCall };
        }

        return null;  // All agent attempts failed
      });
    } catch (err) {
      logger.error(`Allocation transaction failed: ${err}`, {
        campaignId,
        component: 'CallAllocator',
      });
      return { success: false, failureReason: `Transaction failed: ${err}` };
    }

    if (!reserved) {
      return { success: false, failureReason: 'No available agents or borrowers' };
    }

    // ----- PHASE 2: Provider call (OUTSIDE transaction) -----
    // This is the distributed boundary. We cannot atomically combine
    // a DB transaction with an external network call.
    try {
      const response = this.initiateProviderCall(reserved.call, reserved.borrower, provider);

      if (response.status === 'failed') {
        throw new Error(`Provider failed to initiate call: ${response.status}`);
      }

      // Update call with provider info
      this.callRepo.transitionState(reserved.call.id, 'INITIATED', reserved.call.version, {
        providerCallId: response.providerCallId,
        providerName: provider.name,
      });

      // Update agent to DIALING
      this.agentRepo.transitionState(reserved.agent.id, 'DIALING', reserved.agent.version);

      const finalCall = this.callRepo.findById(reserved.call.id)!;

      logger.info('Call initiated with provider', {
        campaignId,
        callId: finalCall.id,
        providerCallId: response.providerCallId,
        provider: provider.name,
        component: 'CallAllocator',
      });

      return {
        success: true,
        call: finalCall,
        agent: this.agentRepo.findById(reserved.agent.id)!,
        borrower: reserved.borrower,
      };
    } catch (err) {
      // Provider call failed — release resources
      logger.warn(`Provider call failed, releasing resources: ${err}`, {
        campaignId,
        agentId: reserved.agent.id,
        callId: reserved.call.id,
        component: 'CallAllocator',
      });

      this.releaseFailedAllocation(reserved.agent, reserved.borrower, reserved.call, String(err));
      return { success: false, failureReason: `Provider call failed: ${err}` };
    }
  }

  /**
   * Allocate call without initiating provider call.
   * Used for testing the allocation logic in isolation.
   */
  allocateOnly(campaignId: string): AllocationResult {
    try {
      const result = withTransaction(this.db, () => {
        const availableAgents = this.agentRepo.findAvailableByCampaign(campaignId);
        if (availableAgents.length === 0) {
          return null;
        }

        for (const candidateAgent of availableAgents) {
          const borrower = this.borrowerRepo.selectNextEligible(campaignId);
          if (!borrower) return null;

          const call = this.callRepo.create({
            campaignId,
            agentId: candidateAgent.id,
            borrowerId: borrower.id,
            attemptNumber: borrower.attemptCount + 1,
          });

          const agentReserved = this.agentRepo.reserveAgent(
            candidateAgent.id, call.id, candidateAgent.version,
          );
          if (!agentReserved) {
            this.callRepo.transitionState(call.id, 'CANCELLED', call.version, {
              failureReason: 'Agent reservation conflict',
            });
            continue;
          }

          const borrowerAllocated = this.borrowerRepo.allocate(borrower.id, borrower.version);
          if (!borrowerAllocated) {
            this.agentRepo.releaseStaleReservation(candidateAgent.id, candidateAgent.version + 1);
            this.callRepo.transitionState(call.id, 'CANCELLED', call.version, {
              failureReason: 'Borrower allocation conflict',
            });
            continue;
          }

          this.callRepo.transitionState(call.id, 'RESERVED', call.version);
          const updatedCall = this.callRepo.findById(call.id)!;
          const updatedAgent = this.agentRepo.findById(candidateAgent.id)!;

          return { agent: updatedAgent, borrower, call: updatedCall };
        }
        return null;
      });

      if (!result) {
        return { success: false, failureReason: 'No available agents or borrowers' };
      }
      return { success: true, ...result };
    } catch (err) {
      return { success: false, failureReason: `Allocation failed: ${err}` };
    }
  }

  /**
   * Release resources after a failed provider call.
   */
  private releaseFailedAllocation(agent: Agent, borrower: Borrower, call: Call, reason: string): void {
    try {
      const currentCall = this.callRepo.findById(call.id);
      if (currentCall && !['FAILED', 'CANCELLED', 'COMPLETED'].includes(currentCall.state)) {
        this.callRepo.transitionState(call.id, 'FAILED', currentCall.version, {
          failureReason: reason,
        });
      }
    } catch (err) {
      logger.error(`Failed to mark call as FAILED: ${err}`, { callId: call.id, component: 'CallAllocator' });
    }

    try {
      const currentAgent = this.agentRepo.findById(agent.id);
      if (currentAgent && currentAgent.state === 'RESERVED') {
        this.agentRepo.releaseStaleReservation(agent.id, currentAgent.version);
      }
    } catch (err) {
      logger.error(`Failed to release agent: ${err}`, { agentId: agent.id, component: 'CallAllocator' });
    }

    try {
      // Determine if borrower should be released for retry
      const currentBorrower = this.borrowerRepo.findById(borrower.id);
      if (currentBorrower && currentBorrower.status === 'allocated') {
        if (currentBorrower.attemptCount >= this.config.provider.retryMaxAttempts) {
          this.borrowerRepo.exhaust(borrower.id);
        } else {
          // Calculate backoff for next retry
          const backoffMs = Math.min(
            this.config.provider.retryBackoffBaseMs * Math.pow(2, currentBorrower.attemptCount - 1),
            this.config.provider.retryBackoffMaxMs,
          );
          const jitter = Math.random() * this.config.provider.retryJitterMs;
          const nextEligibleAt = new Date(Date.now() + backoffMs + jitter).toISOString();
          this.borrowerRepo.release(borrower.id, nextEligibleAt);
        }
      }
    } catch (err) {
      logger.error(`Failed to release borrower: ${err}`, { borrowerId: borrower.id, component: 'CallAllocator' });
    }
  }

  private initiateProviderCall(call: Call, borrower: Borrower, provider: TelecomProvider): InitiateCallResponse {
    return provider.initiateCall({
      callId: call.id,
      phoneNumber: borrower.phoneNumber,
      campaignId: call.campaignId,
    });
  }
}
