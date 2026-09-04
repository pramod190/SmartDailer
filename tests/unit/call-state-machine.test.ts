// ============================================================================
// Unit Tests — Call State Machine
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  CallStateMachine,
  InvalidCallTransitionError,
  TERMINAL_CALL_STATES,
  CALL_STATES,
  type CallState,
} from '../../src/domain/call/CallState.js';

describe('CallStateMachine', () => {
  // --- Valid transitions ---
  const validTransitions: Array<[CallState, CallState]> = [
    ['QUEUED', 'RESERVED'],
    ['QUEUED', 'CANCELLED'],
    ['QUEUED', 'FAILED'],
    ['RESERVED', 'INITIATED'],
    ['RESERVED', 'CANCELLED'],
    ['RESERVED', 'FAILED'],
    ['INITIATED', 'RINGING'],
    ['INITIATED', 'ANSWERED'],     // Some providers skip RINGING
    ['INITIATED', 'CONNECTED'],    // Some providers skip RINGING+ANSWERED
    ['INITIATED', 'FAILED'],
    ['INITIATED', 'CANCELLED'],
    ['RINGING', 'ANSWERED'],
    ['RINGING', 'CONNECTED'],      // Skip ANSWERED
    ['RINGING', 'FAILED'],         // No answer / busy
    ['RINGING', 'CANCELLED'],
    ['RINGING', 'COMPLETED'],      // Provider reports completed directly
    ['ANSWERED', 'CONNECTED'],
    ['ANSWERED', 'COMPLETED'],
    ['ANSWERED', 'FAILED'],
    ['CONNECTED', 'COMPLETED'],
    ['CONNECTED', 'FAILED'],
  ];

  describe('valid transitions', () => {
    for (const [from, to] of validTransitions) {
      it(`${from} → ${to} should be allowed`, () => {
        expect(CallStateMachine.canTransition(from, to)).toBe(true);
      });
    }
  });

  // --- Terminal state protection (CRITICAL) ---
  describe('terminal state protection', () => {
    const terminalStates: CallState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
    const allTargets: CallState[] = [...CALL_STATES];

    for (const terminal of terminalStates) {
      for (const target of allTargets) {
        it(`${terminal} → ${target} must be REJECTED`, () => {
          expect(CallStateMachine.canTransition(terminal, target)).toBe(false);
        });
      }
    }
  });

  // --- Duplicate event resilience ---
  describe('duplicate event handling', () => {
    it('ANSWERED → ANSWERED is rejected (duplicate)', () => {
      // If call is ANSWERED, transition to ANSWERED again is not in valid transitions
      // This is fine because the state machine won't allow same-state transitions
      // from non-terminal states that don't list themselves
      expect(CallStateMachine.canTransition('ANSWERED', 'ANSWERED')).toBe(false);
    });

    it('CONNECTED → CONNECTED is rejected', () => {
      expect(CallStateMachine.canTransition('CONNECTED', 'CONNECTED')).toBe(false);
    });

    it('COMPLETED → COMPLETED is rejected', () => {
      expect(CallStateMachine.canTransition('COMPLETED', 'COMPLETED')).toBe(false);
    });
  });

  // --- Out-of-order event resilience ---
  describe('out-of-order events', () => {
    it('COMPLETED → ANSWERED is rejected (backward from terminal)', () => {
      expect(CallStateMachine.canTransition('COMPLETED', 'ANSWERED')).toBe(false);
    });

    it('COMPLETED → RINGING is rejected (backward from terminal)', () => {
      expect(CallStateMachine.canTransition('COMPLETED', 'RINGING')).toBe(false);
    });

    it('FAILED → ANSWERED is rejected', () => {
      expect(CallStateMachine.canTransition('FAILED', 'ANSWERED')).toBe(false);
    });

    it('CANCELLED → RINGING is rejected', () => {
      expect(CallStateMachine.canTransition('CANCELLED', 'RINGING')).toBe(false);
    });
  });

  // --- Backward transition detection ---
  describe('isBackwardTransition', () => {
    it('CONNECTED → RINGING is backward', () => {
      expect(CallStateMachine.isBackwardTransition('CONNECTED', 'RINGING')).toBe(true);
    });

    it('ANSWERED → INITIATED is backward', () => {
      expect(CallStateMachine.isBackwardTransition('ANSWERED', 'INITIATED')).toBe(true);
    });

    it('RINGING → ANSWERED is forward', () => {
      expect(CallStateMachine.isBackwardTransition('RINGING', 'ANSWERED')).toBe(false);
    });

    it('COMPLETED → ANSWERED is backward', () => {
      expect(CallStateMachine.isBackwardTransition('COMPLETED', 'ANSWERED')).toBe(true);
    });
  });

  // --- State classification ---
  describe('isTerminal', () => {
    it('COMPLETED, FAILED, CANCELLED are terminal', () => {
      expect(CallStateMachine.isTerminal('COMPLETED')).toBe(true);
      expect(CallStateMachine.isTerminal('FAILED')).toBe(true);
      expect(CallStateMachine.isTerminal('CANCELLED')).toBe(true);
    });

    it('active states are not terminal', () => {
      expect(CallStateMachine.isTerminal('QUEUED')).toBe(false);
      expect(CallStateMachine.isTerminal('INITIATED')).toBe(false);
      expect(CallStateMachine.isTerminal('RINGING')).toBe(false);
      expect(CallStateMachine.isTerminal('CONNECTED')).toBe(false);
    });
  });

  describe('isActive', () => {
    it('QUEUED through CONNECTED are active', () => {
      expect(CallStateMachine.isActive('QUEUED')).toBe(true);
      expect(CallStateMachine.isActive('RESERVED')).toBe(true);
      expect(CallStateMachine.isActive('INITIATED')).toBe(true);
      expect(CallStateMachine.isActive('RINGING')).toBe(true);
      expect(CallStateMachine.isActive('ANSWERED')).toBe(true);
      expect(CallStateMachine.isActive('CONNECTED')).toBe(true);
    });

    it('terminal states are not active', () => {
      expect(CallStateMachine.isActive('COMPLETED')).toBe(false);
      expect(CallStateMachine.isActive('FAILED')).toBe(false);
      expect(CallStateMachine.isActive('CANCELLED')).toBe(false);
    });
  });

  describe('validateTransition', () => {
    it('throws InvalidCallTransitionError for invalid transitions', () => {
      expect(() => CallStateMachine.validateTransition('COMPLETED', 'ANSWERED'))
        .toThrow(InvalidCallTransitionError);
    });

    it('does not throw for valid transitions', () => {
      expect(() => CallStateMachine.validateTransition('RINGING', 'ANSWERED'))
        .not.toThrow();
    });
  });
});
