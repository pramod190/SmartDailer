// ============================================================================
// SmartDialer — Provider A: Reliable Mock Provider
// ============================================================================
// Fast, reliable, low failure rate, predictable latency.
// Simulates a well-behaved telecom provider for testing.
//
// Characteristics:
// - 95-99% success rate (configurable)
// - 50-200ms latency (configurable)
// - Generates sequential events: RINGING → ANSWERED → CONNECTED → COMPLETED
// - No duplicate events, no out-of-order events
// ============================================================================

import { v4 as uuid } from 'uuid';
import type {
  TelecomProvider,
  CallRequest,
  InitiateCallResponse,
  ProviderEvent,
} from './TelecomProvider.js';

export interface ReliableMockProviderConfig {
  failureRate: number;          // 0.0-1.0, default 0.02
  minLatencyMs: number;         // default 50
  maxLatencyMs: number;         // default 200
  answerRate: number;           // probability call is answered, default 0.5
  avgTalkTimeSec: number;       // average talk duration, default 90
}

const DEFAULT_CONFIG: ReliableMockProviderConfig = {
  failureRate: 0.02,
  minLatencyMs: 50,
  maxLatencyMs: 200,
  answerRate: 0.5,
  avgTalkTimeSec: 90,
};

export class ReliableMockProvider implements TelecomProvider {
  readonly name = 'reliable-mock';
  private config: ReliableMockProviderConfig;
  private eventQueue: ProviderEvent[] = [];
  private callSequences: Map<string, number> = new Map();
  private rng: () => number;

  constructor(config?: Partial<ReliableMockProviderConfig>, seed?: number) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Deterministic RNG for reproducible tests
    this.rng = seed !== undefined ? this.createSeededRng(seed) : Math.random.bind(Math);
  }

  initiateCall(request: CallRequest): InitiateCallResponse {
    const startTime = Date.now();
    const latency = this.randomBetween(this.config.minLatencyMs, this.config.maxLatencyMs);

    // Simulate provider failure
    if (this.rng() < this.config.failureRate) {
      return {
        providerCallId: '',
        status: 'failed',
        latencyMs: latency,
      };
    }

    const providerCallId = `rel-${uuid().substring(0, 8)}`;
    this.callSequences.set(providerCallId, 0);

    // Generate events that will happen for this call
    this.generateCallEvents(providerCallId, request.callId);

    return {
      providerCallId,
      status: 'initiated',
      latencyMs: latency,
    };
  }

  cancelCall(providerCallId: string): void {
    // Remove pending events for this call
    this.eventQueue = this.eventQueue.filter(e => e.providerCallId !== providerCallId);

    // Generate CANCELLED event
    const seq = this.nextSequence(providerCallId);
    this.eventQueue.push({
      eventId: uuid(),
      providerCallId,
      eventType: 'CANCELLED',
      sequenceNumber: seq,
      timestamp: new Date().toISOString(),
      payload: { reason: 'cancelled_by_system' },
    });
  }

  getHealthStatus(): 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' {
    return 'HEALTHY';
  }

  /**
   * Drain all pending events (for simulation/testing).
   * Returns events in the order they were generated.
   */
  drainEvents(): ProviderEvent[] {
    const events = [...this.eventQueue];
    this.eventQueue = [];
    return events;
  }

  /**
   * Get the next event without removing it.
   */
  peekNextEvent(): ProviderEvent | undefined {
    return this.eventQueue[0];
  }

  /**
   * Get count of pending events.
   */
  pendingEventCount(): number {
    return this.eventQueue.length;
  }

  private generateCallEvents(providerCallId: string, _callId: string): void {
    // Always generate RINGING first
    const ringingSeq = this.nextSequence(providerCallId);
    this.eventQueue.push({
      eventId: uuid(),
      providerCallId,
      eventType: 'RINGING',
      sequenceNumber: ringingSeq,
      timestamp: new Date().toISOString(),
      payload: {},
    });

    // Determine if call is answered
    if (this.rng() < this.config.answerRate) {
      // ANSWERED
      const answeredSeq = this.nextSequence(providerCallId);
      this.eventQueue.push({
        eventId: uuid(),
        providerCallId,
        eventType: 'ANSWERED',
        sequenceNumber: answeredSeq,
        timestamp: new Date().toISOString(),
        payload: {},
      });

      // CONNECTED
      const connectedSeq = this.nextSequence(providerCallId);
      this.eventQueue.push({
        eventId: uuid(),
        providerCallId,
        eventType: 'CONNECTED',
        sequenceNumber: connectedSeq,
        timestamp: new Date().toISOString(),
        payload: {},
      });

      // COMPLETED (after talk time)
      const completedSeq = this.nextSequence(providerCallId);
      this.eventQueue.push({
        eventId: uuid(),
        providerCallId,
        eventType: 'COMPLETED',
        sequenceNumber: completedSeq,
        timestamp: new Date().toISOString(),
        payload: { duration_sec: this.config.avgTalkTimeSec + this.randomBetween(-30, 30) },
      });
    } else {
      // Not answered → FAILED (no answer / busy)
      const failedSeq = this.nextSequence(providerCallId);
      this.eventQueue.push({
        eventId: uuid(),
        providerCallId,
        eventType: 'FAILED',
        sequenceNumber: failedSeq,
        timestamp: new Date().toISOString(),
        payload: { reason: this.rng() < 0.5 ? 'no_answer' : 'busy' },
      });
    }
  }

  private nextSequence(providerCallId: string): number {
    const current = this.callSequences.get(providerCallId) ?? 0;
    const next = current + 1;
    this.callSequences.set(providerCallId, next);
    return next;
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(this.rng() * (max - min + 1)) + min;
  }

  private createSeededRng(seed: number): () => number {
    // Simple mulberry32 PRNG for deterministic testing
    let s = seed;
    return () => {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
}
