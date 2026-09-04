// ============================================================================
// SmartDialer — Provider Health Model
// ============================================================================

export const HEALTH_STATUSES = ['HEALTHY', 'DEGRADED', 'UNHEALTHY'] as const;
export type HealthStatus = typeof HEALTH_STATUSES[number];

export interface ProviderHealth {
  providerName: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  timedOutCalls: number;
  totalLatencyMs: number;
  healthStatus: HealthStatus;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  updatedAt: string;
}

export function calculateSuccessRate(health: ProviderHealth): number {
  if (health.totalCalls === 0) return 1.0;
  return health.successfulCalls / health.totalCalls;
}

export function calculateAverageLatency(health: ProviderHealth): number {
  if (health.totalCalls === 0) return 0;
  return health.totalLatencyMs / health.totalCalls;
}

export function calculateFailureRate(health: ProviderHealth): number {
  if (health.totalCalls === 0) return 0;
  return (health.failedCalls + health.timedOutCalls) / health.totalCalls;
}
