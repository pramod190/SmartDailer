// ============================================================================
// Unit Tests — Agent State Machine
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  AgentStateMachine,
  InvalidAgentTransitionError,
  AGENT_STATES,
  type AgentState,
} from '../../src/domain/agent/AgentState.js';

describe('AgentStateMachine', () => {
  // --- Valid transitions ---
  const validTransitions: Array<[AgentState, AgentState]> = [
    ['OFFLINE', 'AVAILABLE'],
    ['AVAILABLE', 'RESERVED'],
    ['AVAILABLE', 'PAUSED'],
    ['AVAILABLE', 'OFFLINE'],
    ['RESERVED', 'DIALING'],
    ['RESERVED', 'AVAILABLE'],     // Reservation released (e.g., call failed before dial)
    ['RESERVED', 'OFFLINE'],       // Agent disconnects while reserved
    ['DIALING', 'CONNECTED'],      // Call answered
    ['DIALING', 'AVAILABLE'],      // Call failed, agent free again
    ['DIALING', 'OFFLINE'],        // Agent disconnects during dial
    ['CONNECTED', 'WRAP_UP'],      // Call ends
    ['CONNECTED', 'OFFLINE'],      // Agent disconnects during call
    ['WRAP_UP', 'AVAILABLE'],      // Wrap-up complete
    ['WRAP_UP', 'OFFLINE'],
    ['PAUSED', 'AVAILABLE'],       // Unpause
    ['PAUSED', 'OFFLINE'],
  ];

  describe('valid transitions', () => {
    for (const [from, to] of validTransitions) {
      it(`${from} → ${to} should be allowed`, () => {
        expect(AgentStateMachine.canTransition(from, to)).toBe(true);
      });

      it(`${from} → ${to} should not throw`, () => {
        expect(() => AgentStateMachine.validateTransition(from, to)).not.toThrow();
      });
    }
  });

  // --- Invalid transitions ---
  const invalidTransitions: Array<[AgentState, AgentState]> = [
    // Cannot skip states
    ['OFFLINE', 'DIALING'],
    ['OFFLINE', 'CONNECTED'],
    ['OFFLINE', 'RESERVED'],
    ['AVAILABLE', 'DIALING'],     // Must go through RESERVED first
    ['AVAILABLE', 'CONNECTED'],
    ['RESERVED', 'CONNECTED'],    // Must go through DIALING first
    ['RESERVED', 'WRAP_UP'],
    ['DIALING', 'RESERVED'],      // Cannot go backward
    ['DIALING', 'WRAP_UP'],       // Must go through CONNECTED
    ['CONNECTED', 'AVAILABLE'],   // Must go through WRAP_UP
    ['CONNECTED', 'RESERVED'],
    ['CONNECTED', 'DIALING'],
    ['WRAP_UP', 'CONNECTED'],     // Cannot go backward
    ['WRAP_UP', 'RESERVED'],
    ['PAUSED', 'RESERVED'],
    ['PAUSED', 'CONNECTED'],
    // Self-transitions
    ['AVAILABLE', 'AVAILABLE'],
    ['RESERVED', 'RESERVED'],
  ];

  describe('invalid transitions', () => {
    for (const [from, to] of invalidTransitions) {
      it(`${from} → ${to} should be rejected`, () => {
        expect(AgentStateMachine.canTransition(from, to)).toBe(false);
      });

      it(`${from} → ${to} should throw InvalidAgentTransitionError`, () => {
        expect(() => AgentStateMachine.validateTransition(from, to))
          .toThrow(InvalidAgentTransitionError);
      });
    }
  });

  // --- Helper methods ---
  describe('isBusy', () => {
    it('RESERVED, DIALING, CONNECTED, WRAP_UP are busy', () => {
      expect(AgentStateMachine.isBusy('RESERVED')).toBe(true);
      expect(AgentStateMachine.isBusy('DIALING')).toBe(true);
      expect(AgentStateMachine.isBusy('CONNECTED')).toBe(true);
      expect(AgentStateMachine.isBusy('WRAP_UP')).toBe(true);
    });

    it('OFFLINE, AVAILABLE, PAUSED are not busy', () => {
      expect(AgentStateMachine.isBusy('OFFLINE')).toBe(false);
      expect(AgentStateMachine.isBusy('AVAILABLE')).toBe(false);
      expect(AgentStateMachine.isBusy('PAUSED')).toBe(false);
    });
  });

  describe('isAllocatable', () => {
    it('only AVAILABLE is allocatable', () => {
      for (const state of AGENT_STATES) {
        expect(AgentStateMachine.isAllocatable(state)).toBe(state === 'AVAILABLE');
      }
    });
  });

  describe('validTargets', () => {
    it('OFFLINE can only go to AVAILABLE', () => {
      const targets = AgentStateMachine.validTargets('OFFLINE');
      expect(targets.size).toBe(1);
      expect(targets.has('AVAILABLE')).toBe(true);
    });

    it('AVAILABLE has three targets', () => {
      const targets = AgentStateMachine.validTargets('AVAILABLE');
      expect(targets.has('RESERVED')).toBe(true);
      expect(targets.has('PAUSED')).toBe(true);
      expect(targets.has('OFFLINE')).toBe(true);
    });
  });
});
