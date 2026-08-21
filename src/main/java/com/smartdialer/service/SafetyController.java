package com.smartdialer.service;

import com.smartdialer.domain.*;
import com.smartdialer.provider.TelecomProvider;

public final class SafetyController {
    private final TelecomProvider provider;
    public SafetyController(TelecomProvider provider) { this.provider = provider; }
    public SafetyDecision authorize(int requested, int availableAgents, int reservedAgents, int dialingCalls,
                                    int connectedCalls, int ringingCalls, int staleReservations, int campaignLimit,
                                    int recentFailures, double answerRate) {
        int safeCapacity = Math.max(0, Math.min(availableAgents, campaignLimit) - reservedAgents - dialingCalls - connectedCalls - ringingCalls);
        if (provider.getHealth() == ProviderHealth.UNHEALTHY) return new SafetyDecision(SafetyDecision.Decision.REJECT, 0, "provider unhealthy");
        if (recentFailures >= 3 && answerRate < 0.2) safeCapacity = Math.min(safeCapacity, 1);
        safeCapacity = Math.max(0, safeCapacity - staleReservations);
        int approved = Math.min(Math.max(0, requested), safeCapacity);
        if (approved == 0) return new SafetyDecision(SafetyDecision.Decision.REJECT, 0, "no safe capacity");
        if (approved < requested) return new SafetyDecision(SafetyDecision.Decision.REDUCE, approved, "capacity and provider health reduced request");
        return new SafetyDecision(SafetyDecision.Decision.APPROVE, approved, "request within safe capacity");
    }
}