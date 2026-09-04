// ============================================================================
// SmartDialer — Call State Machine
// ============================================================================
// Explicit state machine for call lifecycle. Designed to be resilient to:
// - Duplicate events (ANSWERED, ANSWERED, ANSWERED)
// - Out-of-order events (COMPLETED, ANSWERED, RINGING)
// - Terminal state protection (COMPLETED/FAILED/CANCELLED never revert)
//
// States:
//   QUEUED      → Call created, waiting for agent allocation
//   RESERVED    → Agent and borrower reserved, ready to dial
//   INITIATED   → Call request sent to telecom provider
//   RINGING     → Provider reports the phone is ringing
//   ANSWERED    → Borrower picked up
//   CONNECTED   → Agent and borrower are connected
//   COMPLETED   → Call finished normally
//   FAILED      → Call failed (provider error, timeout, etc.)
//   CANCELLED   → Call was cancelled before completion
// ============================================================================

export const CALL_STATES = [
  'QUEUED',
  'RESERVED',
  'INITIATED',
  'RINGING',
  'ANSWERED',
  'CONNECTED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type CallState = typeof CALL_STATES[number];

/**
 * Terminal states — once a call reaches these, it NEVER goes back.
 * This is the primary defense against out-of-order events.
 */
export const TERMINAL_CALL_STATES: ReadonlySet<CallState> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

/**
 * Active states — calls that consume system resources.
 */
export const ACTIVE_CALL_STATES: ReadonlySet<CallState> = new Set([
  'QUEUED',
  'RESERVED',
  'INITIATED',
  'RINGING',
  'ANSWERED',
  'CONNECTED',
]);

/**
 * Valid state transitions for calls.
 */
const VALID_TRANSITIONS: Record<CallState, ReadonlySet<CallState>> = {
  QUEUED:     new Set<CallState>(['RESERVED', 'CANCELLED', 'FAILED']),
  RESERVED:   new Set<CallState>(['INITIATED', 'CANCELLED', 'FAILED']),
  INITIATED:  new Set<CallState>(['RINGING', 'ANSWERED', 'CONNECTED', 'FAILED', 'CANCELLED']),
  RINGING:    new Set<CallState>(['ANSWERED', 'CONNECTED', 'FAILED', 'CANCELLED', 'COMPLETED']),
  ANSWERED:   new Set<CallState>(['CONNECTED', 'COMPLETED', 'FAILED']),
  CONNECTED:  new Set<CallState>(['COMPLETED', 'FAILED']),
  COMPLETED:  new Set<CallState>([]),    // Terminal — no transitions out
  FAILED:     new Set<CallState>([]),    // Terminal — no transitions out
  CANCELLED:  new Set<CallState>([]),    // Terminal — no transitions out
};

/**
 * State precedence for ordering protection.
 * Higher number = later in lifecycle. Used to reject backward transitions
 * when sequence numbers are unavailable.
 */
export const STATE_PRECEDENCE: Record<CallState, number> = {
  QUEUED: 0,
  RESERVED: 1,
  INITIATED: 2,
  RINGING: 3,
  ANSWERED: 4,
  CONNECTED: 5,
  COMPLETED: 6,
  FAILED: 6,     // Same level as COMPLETED (both terminal)
  CANCELLED: 6,  // Same level as COMPLETED (both terminal)
};

export class CallStateMachine {
  /**
   * Check whether a transition from `from` to `to` is valid.
   */
  static canTransition(from: CallState, to: CallState): boolean {
    // Terminal states NEVER transition
    if (TERMINAL_CALL_STATES.has(from)) {
      return false;
    }
    const allowed = VALID_TRANSITIONS[from];
    return allowed.has(to);
  }

  /**
   * Validate a transition. Throws if invalid.
   */
  static validateTransition(from: CallState, to: CallState): void {
    if (!CallStateMachine.canTransition(from, to)) {
      throw new InvalidCallTransitionError(from, to);
    }
  }

  /**
   * Check if the state is terminal (call is done).
   */
  static isTerminal(state: CallState): boolean {
    return TERMINAL_CALL_STATES.has(state);
  }

  /**
   * Check if the state is active (consuming resources).
   */
  static isActive(state: CallState): boolean {
    return ACTIVE_CALL_STATES.has(state);
  }

  /**
   * Check if a state transition would be a backward movement.
   * Used for out-of-order event protection when sequence numbers
   * aren't available.
   */
  static isBackwardTransition(from: CallState, to: CallState): boolean {
    return STATE_PRECEDENCE[to] < STATE_PRECEDENCE[from];
  }

  /**
   * Get all valid target states from the given state.
   */
  static validTargets(from: CallState): ReadonlySet<CallState> {
    if (TERMINAL_CALL_STATES.has(from)) {
      return new Set();
    }
    return VALID_TRANSITIONS[from];
  }
}

export class InvalidCallTransitionError extends Error {
  constructor(
    public readonly from: CallState,
    public readonly to: CallState,
  ) {
    super(`Invalid call state transition: ${from} → ${to}`);
    this.name = 'InvalidCallTransitionError';
  }
}

// --- Call Model ---

export interface Call {
  id: string;
  campaignId: string;
  agentId: string | null;
  borrowerId: string;
  providerCallId: string | null;
  providerName: string | null;
  state: CallState;
  attemptNumber: number;
  createdAt: string;
  initiatedAt: string | null;
  ringingAt: string | null;
  answeredAt: string | null;
  connectedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  version: number;
  lastProviderSequence: number;
  updatedAt: string;
}
