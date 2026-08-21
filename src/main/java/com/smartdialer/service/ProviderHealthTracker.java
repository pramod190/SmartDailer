package com.smartdialer.service;

import com.smartdialer.domain.ProviderHealth;

public final class ProviderHealthTracker {
    private int consecutiveFailures;
    private ProviderHealth health = ProviderHealth.HEALTHY;
    public synchronized void recordSuccess() { consecutiveFailures = 0; health = ProviderHealth.HEALTHY; }
    public synchronized void recordFailure() { consecutiveFailures++; health = consecutiveFailures >= 5 ? ProviderHealth.UNHEALTHY : consecutiveFailures >= 2 ? ProviderHealth.DEGRADED : ProviderHealth.HEALTHY; }
    public synchronized ProviderHealth health() { return health; }
}