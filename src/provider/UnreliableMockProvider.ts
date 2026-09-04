// ============================================================================
// SmartDialer — Provider B: Unreliable Mock Provider
// ============================================================================
// Slower, occasional timeouts, duplicate events, out-of-order events,
// occasional failures. The system MUST remain correct with this provider.
//
// Characteristics:
// - 10-30% failure rate (configurable)
// - 200-2000ms latency (configurable)
// - 10-20% chance of duplicate events
// - 5-10% chance of out-of-order events
// - Occasional timeouts
// ============================================================================

import { v4 as uuid } from 'uuid';
import type {
  TelecomProvider,
  CallRequest,
  InitiateCallResponse,
  ProviderEvent,
} from './TelecomProvider.js';

export interface UnreliableMockProviderConfig {
  failureRate: number;              // 0.0-1.0, default 0.15
  timeoutRate: number;              // 0.0-1.0, default 0.05
  minLatencyMs: number;             // default 200
  maxLatencyMs: number;             // default 2000
  answerRate: number;               // default 0.4
  avgTalkTimeSec: number;           // default 90
  duplicateEventRate: number;       // 0.0-1.0, default 0.15
  outOfOrderRate: number;           // 0.0-1.0, default 0.08
}

const DEFAULT_CONFIG: UnreliableMockProviderConfig = {
  failureRate: 0.15,
  timeoutRate: 0.05,
  minLatencyMs: 200,
  maxLatencyMs: 2000,
  answerRate: 0.4,
  avgTalkTimeSec: 90,
  duplicateEventRate: 0.15,
  outOfOrderRate: 0.08,
};

export class UnreliableMockProvider implements TelecomProvider {
  readonly name = 'unreliable-mock';
  private config: UnreliableMockProviderConfig;
  private eventQueue: ProviderEvent[] = [];
  private callSequences: Map<string, number> = new Map();
  private rng: () => number;

  constructor(config?: Partial<UnreliableMockProviderConfig>, seed?: number) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = seed !== undefined ? this.createSeededRng(seed) : Math.random.bind(Math);
  }

  initiateCall(request: CallRequest): InitiateCallResponse {
    const latency = this.randomBetween(this.config.minLatencyMs, this.config.maxLatencyMs);

    // Simulate timeout (throws to simulate network timeout)
    if (this.rng() < this.config.timeoutRate) {
      throw new Error(`Provider timeout after ${latency}ms`);
    }

    // Simulate provider failure
    if (this.rng() < this.config.failureRate) {
      return {
        providerCallId: '',
        status: 'failed',
        latencyMs: latency,
      };
    }

    const providerCallId = `unrel-${uuid().substring(0, 8)}`;
    this.callSequences.set(providerCallId, 0);

    // Generate events (potentially with duplicates and reordering)
    this.generateCallEvents(providerCallId);

    return {
      providerCallId,
      status: 'initiated',
      latencyMs: latency,
    };
  }

  cancelCall(providerCallId: string): void {
    this.eventQueue = this.eventQueue.filter(e => e.providerCallId !== providerCallId);

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
    const totalFailureRate = this.config.failureRate + this.config.timeoutRate;
    if (totalFailureRate > 0.3) return 'UNHEALTHY';
    if (totalFailureRate > 0.1) return 'DEGRADED';
    return 'HEALTHY';
  }

  drainEvents(): ProviderEvent[] {
    const events = [...this.eventQueue];
    this.eventQueue = [];
    return events;
  }

  peekNextEvent(): ProviderEvent | undefined {
    return this.eventQueue[0];
  }

  pendingEventCount(): number {
    return this.eventQueue.length;
  }

  /**
   * Inject a specific event (for testing failure scenarios).
   */
  injectEvent(event: ProviderEvent): void {
    this.eventQueue.push(event);
  }

  private generateCallEvents(providerCallId: string): void {
    const events: ProviderEvent[] = [];

    // Generate base event sequence
    const ringingSeq = this.nextSequence(providerCallId);
    events.push(this.createEvent(providerCallId, 'RINGING', ringingSeq));

    if (this.rng() < this.config.answerRate) {
      const answeredSeq = this.nextSequence(providerCallId);
      events.push(this.createEvent(providerCallId, 'ANSWERED', answeredSeq));

      const connectedSeq = this.nextSequence(providerCallId);
      events.push(this.createEvent(providerCallId, 'CONNECTED', connectedSeq));

      const completedSeq = this.nextSequence(providerCallId);
      events.push(this.createEvent(providerCallId, 'COMPLETED', completedSeq, {
        duration_sec: this.config.avgTalkTimeSec + this.randomBetween(-30, 30),
      }));
    } else {
      const failedSeq = this.nextSequence(providerCallId);
      events.push(this.createEvent(providerCallId, 'FAILED', failedSeq, {
        reason: this.rng() < 0.5 ? 'no_answer' : 'busy',
      }));
    }

    // --- Introduce chaos ---

    // Duplicate events: repeat a random event
    if (this.rng() < this.config.duplicateEventRate && events.length > 0) {
      const idx = Math.floor(this.rng() * events.length);
      const duplicate = { ...events[idx]!, eventId: uuid() }; // New event ID, same content
      events.push(duplicate);

      // Sometimes triple-duplicate
      if (this.rng() < 0.3) {
        events.push({ ...events[idx]!, eventId: uuid() });
      }
    }

    // Out-of-order: swap two adjacent events
    if (this.rng() < this.config.outOfOrderRate && events.length > 1) {
      const idx = Math.floor(this.rng() * (events.length - 1));
      const temp = events[idx]!;
      events[idx] = events[idx + 1]!;
      events[idx + 1] = temp;
    }

    this.eventQueue.push(...events);
  }

  private createEvent(
    providerCallId: string,
    eventType: ProviderEvent['eventType'],
    sequenceNumber: number,
    payload: Record<string, unknown> = {},
  ): ProviderEvent {
    return {
      eventId: uuid(),
      providerCallId,
      eventType,
      sequenceNumber,
      timestamp: new Date().toISOString(),
      payload,
    };
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
    let s = seed;
    return () => {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
}
