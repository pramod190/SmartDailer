package com.smartdialer.service;

import com.smartdialer.domain.*;
import java.time.Instant;

public final class PacingEngine {
    public PacingDecision decide(int availableAgents, int connectedCalls, int ringingCalls,
                                 double answerRate, double averageTalkTime, ProviderHealth health) {
        int buffer = Math.max(1, (int) Math.ceil(availableAgents * 0.15));
        double demand = connectedCalls + ringingCalls + (availableAgents * Math.max(0.05, answerRate) * averageTalkTime / 120.0);
        int requested = Math.max(0, (int) Math.ceil(availableAgents - demand - buffer));
        if (health == ProviderHealth.DEGRADED) requested = Math.max(0, requested / 2);
        if (health == ProviderHealth.UNHEALTHY) requested = 0;
        String reason = "available=" + availableAgents + ", demand=" + String.format("%.2f", demand) + ", buffer=" + buffer;
        return new PacingDecision(requested, availableAgents, connectedCalls, ringingCalls, answerRate, averageTalkTime, health, buffer, demand, reason, Instant.now());
    }
}