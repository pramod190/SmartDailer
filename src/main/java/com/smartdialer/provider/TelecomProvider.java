package com.smartdialer.provider;

import com.smartdialer.domain.ProviderHealth;
import com.smartdialer.domain.ProviderEventType;
import java.util.UUID;
import java.util.List;

public interface TelecomProvider {
    ProviderCallResult initiateCall(UUID callId, String borrowerId);
    boolean cancelCall(UUID callId);
    ProviderHealth getHealth();
    default List<com.smartdialer.domain.ProviderEvent> pollEvents(UUID callId) { return List.of(); }
    record ProviderCallResult(boolean accepted, String providerCallId, ProviderEventType initialEvent, String failureReason) { }
}