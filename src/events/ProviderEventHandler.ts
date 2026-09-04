// ============================================================================
// SmartDialer — Provider Event Handler
// ============================================================================
// Processes telecom provider events with three layers of protection:
//
// 1. IDEMPOTENCY: provider_events table with unique (provider, eventId)
//    prevents processing the same event twice.
//
// 2. EVENT ORDERING: sequence number comparison prevents backward transitions.
//    If a call is at sequence 5 and we receive sequence 3, the event is stale.
//
// 3. STATE MACHINE: the call/agent state machines reject invalid transitions
//    as a final safety net. Even if layers 1 and 2 somehow pass, the state
//    machine will catch COMPLETED → ANSWERED.
//
// Flow:
//   Provider Event → Idempotency Check → Ordering Check →
//   Call State Machine → Agent State Machine → Metrics
// ============================================================================

import { v4 as uuid } from 'uuid';
import type { Database } from '../infrastructure/database.js';
import type { ProviderEvent } from '../provider/TelecomProvider.js';
import { CallRepository } from '../domain/call/CallRepository.js';
import { AgentRepository } from '../domain/agent/AgentRepository.js';
import { BorrowerRepository } from '../domain/borrower/BorrowerRepository.js';
import { ProviderHealthRepository } from '../domain/provider/ProviderHealthRepository.js';
import { CallStateMachine, type CallState } from '../domain/call/CallState.js';
import type { Call } from '../domain/call/CallState.js';
import { logger } from '../common/logger.js';
import { SmartDialerConfig } from '../config.js';

export interface EventProcessingResult {
  processed: boolean;
  duplicate: boolean;
  stale: boolean;
  invalidTransition: boolean;
  callId?: string;
  previousState?: CallState;
  newState?: CallState;
  reason?: string;
}

export class ProviderEventHandler {
  private readonly callRepo: CallRepository;
  private readonly agentRepo: AgentRepository;
  private readonly borrowerRepo: BorrowerRepository;
  private readonly healthRepo: ProviderHealthRepository;

  constructor(
    private readonly db: Database,
    private readonly config: SmartDialerConfig,
  ) {
    this.callRepo = new CallRepository(db);
    this.agentRepo = new AgentRepository(db);
    this.borrowerRepo = new BorrowerRepository(db);
    this.healthRepo = new ProviderHealthRepository(db);
  }

  /**
   * Process a provider event through the full pipeline:
   * Idempotency → Ordering → State Transition → Side Effects
   */
  processEvent(event: ProviderEvent): EventProcessingResult {
    const logCtx = {
      eventId: event.eventId,
      providerCallId: event.providerCallId,
      eventType: event.eventType,
      component: 'ProviderEventHandler',
    };

    // --- Layer 1: Idempotency Check ---
    if (this.isDuplicate(event)) {
      logger.info('Duplicate event ignored', logCtx);
      this.recordEvent(event, true);
      return { processed: false, duplicate: true, stale: false, invalidTransition: false, reason: 'Duplicate event' };
    }

    // Record the event (marks it as seen)
    this.recordEvent(event, false);

    // --- Find the call ---
    const call = this.callRepo.findByProviderCallId(event.providerCallId);
    if (!call) {
      logger.warn('Event for unknown call, ignoring', logCtx);
      return { processed: false, duplicate: false, stale: false, invalidTransition: false, reason: 'Unknown call' };
    }

    // --- Layer 2: Event Ordering Check ---
    if (this.isStaleEvent(call, event)) {
      logger.info('Stale event ignored (sequence too old)', { ...logCtx, callId: call.id });
      return {
        processed: false, duplicate: false, stale: true, invalidTransition: false,
        callId: call.id, previousState: call.state, reason: 'Stale sequence number',
      };
    }

    // --- Layer 3: State Machine Validation ---
    const targetState = this.mapEventToCallState(event.eventType);
    if (!targetState) {
      logger.warn('Unknown event type', logCtx);
      return { processed: false, duplicate: false, stale: false, invalidTransition: false, reason: 'Unknown event type' };
    }

    // Check if this would be a backward transition
    if (CallStateMachine.isBackwardTransition(call.state, targetState)) {
      logger.info('Backward transition rejected', {
        ...logCtx, callId: call.id,
        currentState: call.state, targetState,
      });
      return {
        processed: false, duplicate: false, stale: false, invalidTransition: true,
        callId: call.id, previousState: call.state, newState: targetState,
        reason: `Backward transition: ${call.state} → ${targetState}`,
      };
    }

    if (!CallStateMachine.canTransition(call.state, targetState)) {
      logger.info('Invalid transition rejected by state machine', {
        ...logCtx, callId: call.id,
        currentState: call.state, targetState,
      });
      return {
        processed: false, duplicate: false, stale: false, invalidTransition: true,
        callId: call.id, previousState: call.state, newState: targetState,
        reason: `Invalid transition: ${call.state} → ${targetState}`,
      };
    }

    // --- Apply state transition ---
    const previousState = call.state;

    try {
      const transitioned = this.callRepo.transitionState(call.id, targetState, call.version, {
        lastProviderSequence: event.sequenceNumber,
        failureReason: event.eventType === 'FAILED'
          ? (event.payload?.['reason'] as string) ?? 'provider_failure'
          : undefined,
      });

      if (!transitioned) {
        logger.warn('Call transition failed (version conflict)', { ...logCtx, callId: call.id });
        return {
          processed: false, duplicate: false, stale: false, invalidTransition: false,
          callId: call.id, previousState, reason: 'Version conflict during transition',
        };
      }

      // --- Apply agent/borrower side effects ---
      this.applySideEffects(call, previousState, targetState, event);

      logger.info(`Call transitioned: ${previousState} → ${targetState}`, {
        ...logCtx, callId: call.id,
      });

      return {
        processed: true, duplicate: false, stale: false, invalidTransition: false,
        callId: call.id, previousState, newState: targetState,
      };
    } catch (err) {
      logger.error(`Event processing error: ${err}`, { ...logCtx, callId: call.id });
      return {
        processed: false, duplicate: false, stale: false, invalidTransition: false,
        callId: call.id, previousState, reason: `Error: ${err}`,
      };
    }
  }

  // --- Idempotency ---

  private isDuplicate(event: ProviderEvent): boolean {
    const row = this.db.prepare(`
      SELECT id FROM provider_events
      WHERE provider_name = ? AND event_id = ?
    `).get('provider', event.eventId);
    return row !== undefined;
  }

  private recordEvent(event: ProviderEvent, duplicate: boolean): void {
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO provider_events
          (id, event_id, provider_name, provider_call_id, event_type,
           sequence_number, payload_json, processed, duplicate)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        uuid(), event.eventId, 'provider', event.providerCallId,
        event.eventType, event.sequenceNumber,
        JSON.stringify(event.payload), duplicate ? 1 : 0,
      );
    } catch {
      // UNIQUE constraint violation = already recorded, safe to ignore
    }
  }

  // --- Event Ordering ---

  private isStaleEvent(call: Call, event: ProviderEvent): boolean {
    // If call is in terminal state, ALL new events are stale
    if (CallStateMachine.isTerminal(call.state)) {
      return true;
    }

    // Sequence number check: reject events with sequence <= last processed
    if (event.sequenceNumber > 0 && call.lastProviderSequence > 0) {
      if (event.sequenceNumber <= call.lastProviderSequence) {
        return true;
      }
    }

    return false;
  }

  // --- State Mapping ---

  private mapEventToCallState(eventType: string): CallState | null {
    switch (eventType) {
      case 'RINGING':   return 'RINGING';
      case 'ANSWERED':  return 'ANSWERED';
      case 'CONNECTED': return 'CONNECTED';
      case 'COMPLETED': return 'COMPLETED';
      case 'FAILED':    return 'FAILED';
      case 'CANCELLED': return 'CANCELLED';
      default:          return null;
    }
  }

  // --- Side Effects ---

  private applySideEffects(
    call: Call,
    previousState: CallState,
    newState: CallState,
    event: ProviderEvent,
  ): void {
    const agentId = call.agentId;
    if (!agentId) return;

    const agent = this.agentRepo.findById(agentId);
    if (!agent) return;

    try {
      switch (newState) {
        case 'CONNECTED': {
          // Agent transitions: DIALING → CONNECTED
          if (agent.state === 'DIALING') {
            this.agentRepo.transitionState(agentId, 'CONNECTED', agent.version);
          }
          break;
        }

        case 'COMPLETED': {
          // Agent transitions: CONNECTED → WRAP_UP → AVAILABLE
          if (agent.state === 'CONNECTED') {
            this.agentRepo.transitionState(agentId, 'WRAP_UP', agent.version);
            const wrapAgent = this.agentRepo.findById(agentId);
            if (wrapAgent && wrapAgent.state === 'WRAP_UP') {
              // Auto-complete wrap-up for simulation (in production, agent controls this)
              this.agentRepo.transitionState(agentId, 'AVAILABLE', wrapAgent.version);
            }
          } else if (agent.state === 'DIALING' || agent.state === 'RESERVED') {
            // Call completed without connecting (e.g., provider reports direct completion)
            this.agentRepo.transitionState(agentId, 'AVAILABLE', agent.version);
          }
          // Mark borrower as completed
          this.borrowerRepo.complete(call.borrowerId);
          // Record provider success
          this.healthRepo.recordSuccess('provider', 0);
          break;
        }

        case 'FAILED':
        case 'CANCELLED': {
          // Agent should return to AVAILABLE
          if (agent.state === 'DIALING' || agent.state === 'RESERVED') {
            this.agentRepo.transitionState(agentId, 'AVAILABLE', agent.version);
          } else if (agent.state === 'CONNECTED') {
            this.agentRepo.transitionState(agentId, 'WRAP_UP', agent.version);
            const wrapAgent = this.agentRepo.findById(agentId);
            if (wrapAgent && wrapAgent.state === 'WRAP_UP') {
              this.agentRepo.transitionState(agentId, 'AVAILABLE', wrapAgent.version);
            }
          }

          // Release borrower for retry (if not exhausted)
          const borrower = this.borrowerRepo.findById(call.borrowerId);
          if (borrower && borrower.status === 'allocated') {
            if (borrower.attemptCount >= this.config.provider.retryMaxAttempts) {
              this.borrowerRepo.exhaust(call.borrowerId);
            } else {
              const backoffMs = Math.min(
                this.config.provider.retryBackoffBaseMs * Math.pow(2, borrower.attemptCount - 1),
                this.config.provider.retryBackoffMaxMs,
              );
              const nextEligibleAt = new Date(Date.now() + backoffMs).toISOString();
              this.borrowerRepo.release(call.borrowerId, nextEligibleAt);
            }
          }

          // Record provider failure
          if (newState === 'FAILED') {
            this.healthRepo.recordFailure('provider');
          }
          break;
        }
      }
    } catch (err) {
      // Side effects should not prevent event processing from succeeding
      logger.error(`Side effect error: ${err}`, {
        callId: call.id,
        agentId,
        newState,
        component: 'ProviderEventHandler',
      });
    }
  }
}
