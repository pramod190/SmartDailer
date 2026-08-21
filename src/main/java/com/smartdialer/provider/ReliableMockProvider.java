package com.smartdialer.provider;

import com.smartdialer.domain.ProviderHealth;
import com.smartdialer.domain.ProviderEventType;
import java.util.UUID;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class ReliableMockProvider implements TelecomProvider {
    private volatile ProviderHealth health = ProviderHealth.HEALTHY;
    private final Map<UUID, String> providerCalls = new ConcurrentHashMap<>();
    private final long latencyMillis;
    public ReliableMockProvider() { this(0); }
    public ReliableMockProvider(long latencyMillis) { this.latencyMillis = latencyMillis; }
    public void setHealth(ProviderHealth health) { this.health = health; }
    @Override public ProviderCallResult initiateCall(UUID callId, String borrowerId) {
        delay();
        if (health == ProviderHealth.UNHEALTHY) return new ProviderCallResult(false, null, ProviderEventType.FAILED, "provider unhealthy");
        String providerCallId = "reliable-" + callId; providerCalls.put(callId, providerCallId);
        return new ProviderCallResult(true, providerCallId, ProviderEventType.RINGING, null);
    }
    @Override public boolean cancelCall(UUID callId) { return true; }
    @Override public ProviderHealth getHealth() { return health; }
    private void delay() { if (latencyMillis > 0) try { Thread.sleep(latencyMillis); } catch (InterruptedException exception) { Thread.currentThread().interrupt(); } }
    @Override public List<com.smartdialer.domain.ProviderEvent> pollEvents(UUID callId) {
        String id = providerCalls.get(callId); if (id == null) return List.of();
        return List.of(new com.smartdialer.domain.ProviderEvent(id + ":answered", ProviderEventType.ANSWERED, 2),
                new com.smartdialer.domain.ProviderEvent(id + ":connected", ProviderEventType.CONNECTED, 3),
                new com.smartdialer.domain.ProviderEvent(id + ":completed", ProviderEventType.COMPLETED, 4));
    }
}