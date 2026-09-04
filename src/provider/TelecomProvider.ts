// ============================================================================
// SmartDialer — Telecom Provider Interface
// ============================================================================
// The dialer must NOT know provider-specific internals.
// All provider implementations satisfy this interface.
// ============================================================================

export interface CallRequest {
  callId: string;
  phoneNumber: string;
  campaignId: string;
}

export interface InitiateCallResponse {
  providerCallId: string;
  status: 'initiated' | 'failed';
  latencyMs: number;
}

export interface ProviderEvent {
  eventId: string;
  providerCallId: string;
  eventType: 'RINGING' | 'ANSWERED' | 'CONNECTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  sequenceNumber: number;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface TelecomProvider {
  /** Unique provider name */
  readonly name: string;

  /** Initiate an outbound call. May throw on failure/timeout. */
  initiateCall(request: CallRequest): InitiateCallResponse;

  /** Cancel a previously initiated call. */
  cancelCall(providerCallId: string): void;

  /** Get current provider health assessment. */
  getHealthStatus(): 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
}
