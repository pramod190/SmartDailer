// ============================================================================
// SmartDialer — Provider Health Repository
// ============================================================================

import type { Database } from '../../infrastructure/database.js';
import type { ProviderHealth, HealthStatus } from './ProviderHealth.js';

export class ProviderHealthRepository {
  constructor(private readonly db: Database) {}

  /**
   * Upsert provider health record. Creates if not exists.
   */
  ensureExists(providerName: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO provider_health (provider_name) VALUES (?)
    `).run(providerName);
  }

  findByName(providerName: string): ProviderHealth | null {
    const row = this.db.prepare(
      'SELECT * FROM provider_health WHERE provider_name = ?'
    ).get(providerName) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findAll(): ProviderHealth[] {
    const rows = this.db.prepare('SELECT * FROM provider_health').all() as Record<string, unknown>[];
    return rows.map(r => this.mapRow(r));
  }

  recordSuccess(providerName: string, latencyMs: number): void {
    const now = new Date().toISOString();
    this.ensureExists(providerName);
    this.db.prepare(`
      UPDATE provider_health
      SET total_calls = total_calls + 1,
          successful_calls = successful_calls + 1,
          total_latency_ms = total_latency_ms + ?,
          consecutive_failures = 0,
          last_success_at = ?,
          updated_at = ?
      WHERE provider_name = ?
    `).run(latencyMs, now, now, providerName);

    this.recalculateHealthStatus(providerName);
  }

  recordFailure(providerName: string): void {
    const now = new Date().toISOString();
    this.ensureExists(providerName);
    this.db.prepare(`
      UPDATE provider_health
      SET total_calls = total_calls + 1,
          failed_calls = failed_calls + 1,
          consecutive_failures = consecutive_failures + 1,
          last_failure_at = ?,
          updated_at = ?
      WHERE provider_name = ?
    `).run(now, now, providerName);

    this.recalculateHealthStatus(providerName);
  }

  recordTimeout(providerName: string): void {
    const now = new Date().toISOString();
    this.ensureExists(providerName);
    this.db.prepare(`
      UPDATE provider_health
      SET total_calls = total_calls + 1,
          timed_out_calls = timed_out_calls + 1,
          consecutive_failures = consecutive_failures + 1,
          last_failure_at = ?,
          updated_at = ?
      WHERE provider_name = ?
    `).run(now, now, providerName);

    this.recalculateHealthStatus(providerName);
  }

  /**
   * Recalculate health status based on failure rate and consecutive failures.
   */
  private recalculateHealthStatus(providerName: string): void {
    const health = this.findByName(providerName);
    if (!health) return;

    let status: HealthStatus = 'HEALTHY';

    // UNHEALTHY: too many consecutive failures
    if (health.consecutiveFailures >= 10) {
      status = 'UNHEALTHY';
    }
    // DEGRADED: high failure rate or several consecutive failures
    else if (health.consecutiveFailures >= 3) {
      status = 'DEGRADED';
    }
    else if (health.totalCalls > 10) {
      const failureRate = (health.failedCalls + health.timedOutCalls) / health.totalCalls;
      if (failureRate > 0.5) {
        status = 'UNHEALTHY';
      } else if (failureRate > 0.2) {
        status = 'DEGRADED';
      }
    }

    if (status !== health.healthStatus) {
      this.db.prepare(
        'UPDATE provider_health SET health_status = ?, updated_at = ? WHERE provider_name = ?'
      ).run(status, new Date().toISOString(), providerName);
    }
  }

  /**
   * Reset health stats (for testing/simulation).
   */
  reset(providerName: string): void {
    this.db.prepare(`
      UPDATE provider_health
      SET total_calls = 0, successful_calls = 0, failed_calls = 0,
          timed_out_calls = 0, total_latency_ms = 0, health_status = 'HEALTHY',
          last_failure_at = NULL, consecutive_failures = 0, last_success_at = NULL,
          updated_at = ?
      WHERE provider_name = ?
    `).run(new Date().toISOString(), providerName);
  }

  private mapRow(row: Record<string, unknown>): ProviderHealth {
    return {
      providerName: row['provider_name'] as string,
      totalCalls: row['total_calls'] as number,
      successfulCalls: row['successful_calls'] as number,
      failedCalls: row['failed_calls'] as number,
      timedOutCalls: row['timed_out_calls'] as number,
      totalLatencyMs: row['total_latency_ms'] as number,
      healthStatus: row['health_status'] as HealthStatus,
      lastFailureAt: row['last_failure_at'] as string | null,
      consecutiveFailures: row['consecutive_failures'] as number,
      lastSuccessAt: row['last_success_at'] as string | null,
      updatedAt: row['updated_at'] as string,
    };
  }
}
