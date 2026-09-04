// ============================================================================
// SmartDialer — Agent State Machine
// ============================================================================
// Explicit state machine with validated transitions. Invalid state changes
// are rejected — the system never allows arbitrary agent state mutations.
//
// States:
//   OFFLINE     → Agent not logged in / disconnected
//   AVAILABLE   → Ready to receive a call
//   RESERVED    → Allocated for an outbound call (has a lease)
//   DIALING     → Call is being placed
//   CONNECTED   → Agent is on a live call
//   WRAP_UP     → Post-call work
//   PAUSED      → Manually paused (break, etc.)
//
// Key design decisions:
// - RESERVED has a lease timeout → recovery can reclaim stale reservations
// - DIALING can go back to AVAILABLE if the call fails (no stuck agents)
// - CONNECTED can go to OFFLINE for agent disconnection during call
// ============================================================================

export const AGENT_STATES = [
  'OFFLINE',
  'AVAILABLE',
  'RESERVED',
  'DIALING',
  'CONNECTED',
  'WRAP_UP',
  'PAUSED',
] as const;

export type AgentState = typeof AGENT_STATES[number];

/**
 * Valid state transitions for agents.
 * Key = source state, Value = set of allowed target states.
 */
const VALID_TRANSITIONS: Record<AgentState, ReadonlySet<AgentState>> = {
  OFFLINE:    new Set<AgentState>(['AVAILABLE']),
  AVAILABLE:  new Set<AgentState>(['RESERVED', 'PAUSED', 'OFFLINE']),
  RESERVED:   new Set<AgentState>(['DIALING', 'AVAILABLE', 'OFFLINE']),
  DIALING:    new Set<AgentState>(['CONNECTED', 'AVAILABLE', 'OFFLINE']),
  CONNECTED:  new Set<AgentState>(['WRAP_UP', 'OFFLINE']),
  WRAP_UP:    new Set<AgentState>(['AVAILABLE', 'OFFLINE']),
  PAUSED:     new Set<AgentState>(['AVAILABLE', 'OFFLINE']),
};

export class AgentStateMachine {
  /**
   * Check whether a transition from `from` to `to` is valid.
   */
  static canTransition(from: AgentState, to: AgentState): boolean {
    const allowed = VALID_TRANSITIONS[from];
    return allowed.has(to);
  }

  /**
   * Validate a transition. Throws if invalid.
   */
  static validateTransition(from: AgentState, to: AgentState): void {
    if (!AgentStateMachine.canTransition(from, to)) {
      throw new InvalidAgentTransitionError(from, to);
    }
  }

  /**
   * Get all valid target states from the given state.
   */
  static validTargets(from: AgentState): ReadonlySet<AgentState> {
    return VALID_TRANSITIONS[from];
  }

  /**
   * Check if a state is a "busy" state (agent cannot be allocated).
   */
  static isBusy(state: AgentState): boolean {
    return state === 'RESERVED' || state === 'DIALING' || state === 'CONNECTED' || state === 'WRAP_UP';
  }

  /**
   * Check if the agent can be allocated for a new call.
   */
  static isAllocatable(state: AgentState): boolean {
    return state === 'AVAILABLE';
  }
}

export class InvalidAgentTransitionError extends Error {
  constructor(
    public readonly from: AgentState,
    public readonly to: AgentState,
  ) {
    super(`Invalid agent state transition: ${from} → ${to}`);
    this.name = 'InvalidAgentTransitionError';
  }
}

// --- Agent Model ---

export interface Agent {
  id: string;
  campaignId: string;
  state: AgentState;
  version: number;
  reservedAt: string | null;
  lastHeartbeatAt: string | null;
  currentCallId: string | null;
  createdAt: string;
  updatedAt: string;
}
