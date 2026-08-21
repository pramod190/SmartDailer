package com.smartdialer.provider;

import com.smartdialer.domain.ProviderHealth;
import com.smartdialer.domain.ProviderEventType;
import java.util.UUID;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

public final class UnreliableMockProvider implements TelecomProvider {
    private volatile ProviderHealth health = ProviderHealth.DEGRADED;
    private final double failureRate;
    private final long latencyMillis;
    private final Map<UUID, String> providerCalls = new ConcurrentHashMap<>();
    public UnreliableMockProvider(double failureRate) { this(failureRate, 0); }
    public UnreliableMockProvider(double failureRate, long latencyMillis) { this.failureRate = failureRate; this.latencyMillis = latencyMillis; }
    public void setHealth(ProviderHealth health) { this.health = health; }
    @Override public ProviderCallResult initiateCall(UUID callId, String borrowerId) {
        if (latencyMillis > 0) try { Thread.sleep(latencyMillis); } catch (InterruptedException exception) { Thread.currentThread().interrupt(); }
        if (health == ProviderHealth.UNHEALTHY || ThreadLocalRandom.current().nextDouble() < failureRate)
            return new ProviderCallResult(false, "unreliable-" + callId, ProviderEventType.FAILED, "simulated timeout/failure");
        String providerCallId = "unreliable-" + callId; providerCalls.put(callId, providerCallId);
        return new ProviderCallResult(true, providerCallId, ProviderEventType.RINGING, null);
    }
    @Override public boolean cancelCall(UUID callId) { return true; }
    @Override public ProviderHealth getHealth() { return health; }
    @Override public List<com.smartdialer.domain.ProviderEvent> pollEvents(UUID callId) {
        String id = providerCalls.get(callId); if (id == null) return List.of();
        return List.of(new com.smartdialer.domain.ProviderEvent(id + ":completed", ProviderEventType.COMPLETED, 4),
                new com.smartdialer.domain.ProviderEvent(id + ":answered-1", ProviderEventType.ANSWERED, 2),
                new com.smartdialer.domain.ProviderEvent(id + ":answered-duplicate", ProviderEventType.ANSWERED, 2),
                new com.smartdialer.domain.ProviderEvent(id + ":ringing-late", ProviderEventType.RINGING, 1));
    }
}