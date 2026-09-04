// ============================================================================
// SmartDialer — Centralized Configuration
// ============================================================================
// All operational parameters are configurable here with sensible defaults.
// No magic numbers in application code — every tunable lives in this file.
// Environment variables override defaults for production deployment.
// ============================================================================

export interface SmartDialerConfig {
  // --- Server ---
  port: number;
  host: string;

  // --- Database ---
  database: {
    path: string;
    walMode: boolean;
    busyTimeout: number;       // ms to wait when DB is locked
  };

  // --- Pacing ---
  pacing: {
    intervalMs: number;        // How often the pacing loop ticks
    mode: 'progressive' | 'predictive';
    maxConcurrentCalls: number; // Hard ceiling on concurrent outbound calls
    safetyBuffer: number;      // Agents to keep in reserve (never dial into)
    answerRateWindow: number;  // Number of recent calls to compute answer rate
    defaultAnswerRate: number; // Used when insufficient history
    defaultTalkTimeSec: number;
    callSetupTimeSec: number;  // Expected time from INITIATED to ANSWERED
    maxOverdialRatio: number;  // Max ratio: requested / available (predictive ceiling)
    maxAbandonRate: number;    // Regulatory limit (e.g., 0.03 = 3%)
    minAnswerRate: number;     // Floor for predictive calculation (prevent div-by-near-zero)
    minSampleSize: number;     // Min calls before using historical answer rate
  };

  // --- Safety Controller ---
  safety: {
    maxAgentUtilization: number;       // 0.0-1.0, e.g. 0.95 = keep 5% idle
    staleReservationTimeoutSec: number; // After this, reservation is considered stale
    minProviderHealthRate: number;      // Below this, reduce/halt dialing
    maxConsecutiveFailures: number;     // Provider failures before degraded
    recentFailureWindowSec: number;     // Window for recent failure rate calc
    maxRecentFailureRate: number;       // Above this, restrict dialing
  };

  // --- Provider ---
  provider: {
    timeoutMs: number;          // Max wait for provider response
    retryMaxAttempts: number;   // Max call attempts per borrower
    retryBackoffBaseMs: number; // Base backoff between retries
    retryBackoffMaxMs: number;  // Maximum backoff cap
    retryJitterMs: number;      // Random jitter added to backoff
    healthCheckIntervalMs: number;
  };

  // --- Recovery ---
  recovery: {
    intervalMs: number;                // How often recovery runs
    leaseTimeoutSec: number;           // Agent reservation lease
    maxStaleRecoveryBatchSize: number;
  };

  // --- Simulation ---
  simulation: {
    defaultAgents: number;
    defaultBorrowers: number;
    defaultDurationSec: number;
    tickIntervalMs: number;
  };
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const parsed = parseInt(v, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const parsed = parseFloat(v);
  return isNaN(parsed) ? fallback : parsed;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function createConfig(overrides?: Partial<SmartDialerConfig>): SmartDialerConfig {
  const defaults: SmartDialerConfig = {
    port: envInt('PORT', 3000),
    host: envStr('HOST', '0.0.0.0'),

    database: {
      path: envStr('DB_PATH', 'smartdialer.db'),
      walMode: true,
      busyTimeout: envInt('DB_BUSY_TIMEOUT', 5000),
    },

    pacing: {
      intervalMs: envInt('PACING_INTERVAL_MS', 2000),
      mode: (envStr('PACING_MODE', 'progressive') as 'progressive' | 'predictive'),
      maxConcurrentCalls: envInt('MAX_CONCURRENT_CALLS', 500),
      safetyBuffer: envInt('SAFETY_BUFFER', 2),
      answerRateWindow: envInt('ANSWER_RATE_WINDOW', 100),
      defaultAnswerRate: envFloat('DEFAULT_ANSWER_RATE', 0.5),
      defaultTalkTimeSec: envInt('DEFAULT_TALK_TIME_SEC', 90),
      callSetupTimeSec: envInt('CALL_SETUP_TIME_SEC', 15),
      maxOverdialRatio: envFloat('MAX_OVERDIAL_RATIO', 1.5),
      maxAbandonRate: envFloat('MAX_ABANDON_RATE', 0.03),
      minAnswerRate: envFloat('MIN_ANSWER_RATE', 0.15),
      minSampleSize: envInt('MIN_SAMPLE_SIZE', 10),
    },

    safety: {
      maxAgentUtilization: envFloat('MAX_AGENT_UTILIZATION', 0.95),
      staleReservationTimeoutSec: envInt('STALE_RESERVATION_TIMEOUT_SEC', 60),
      minProviderHealthRate: envFloat('MIN_PROVIDER_HEALTH_RATE', 0.5),
      maxConsecutiveFailures: envInt('MAX_CONSECUTIVE_FAILURES', 10),
      recentFailureWindowSec: envInt('RECENT_FAILURE_WINDOW_SEC', 120),
      maxRecentFailureRate: envFloat('MAX_RECENT_FAILURE_RATE', 0.5),
    },

    provider: {
      timeoutMs: envInt('PROVIDER_TIMEOUT_MS', 10000),
      retryMaxAttempts: envInt('RETRY_MAX_ATTEMPTS', 3),
      retryBackoffBaseMs: envInt('RETRY_BACKOFF_BASE_MS', 1000),
      retryBackoffMaxMs: envInt('RETRY_BACKOFF_MAX_MS', 30000),
      retryJitterMs: envInt('RETRY_JITTER_MS', 500),
      healthCheckIntervalMs: envInt('HEALTH_CHECK_INTERVAL_MS', 10000),
    },

    recovery: {
      intervalMs: envInt('RECOVERY_INTERVAL_MS', 15000),
      leaseTimeoutSec: envInt('LEASE_TIMEOUT_SEC', 60),
      maxStaleRecoveryBatchSize: envInt('MAX_STALE_RECOVERY_BATCH', 50),
    },

    simulation: {
      defaultAgents: envInt('SIM_AGENTS', 50),
      defaultBorrowers: envInt('SIM_BORROWERS', 500),
      defaultDurationSec: envInt('SIM_DURATION_SEC', 300),
      tickIntervalMs: envInt('SIM_TICK_INTERVAL_MS', 1000),
    },
  };

  // Deep merge overrides
  if (overrides) {
    return deepMerge(defaults as unknown as Record<string, unknown>, overrides as unknown as Record<string, unknown>) as unknown as SmartDialerConfig;
  }
  return defaults;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal) &&
      targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal as Record<string, unknown>, sourceVal as Record<string, unknown>);
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}

// Default singleton for convenience
export const config = createConfig();
