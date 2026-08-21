package com.smartdialer.domain;

import java.time.Instant;

public record PacingDecision(int requestedCalls, int availableAgents, int connectedCalls, int ringingCalls,
                             double estimatedAnswerRate, double averageTalkTime, ProviderHealth providerHealth,
                             int safetyBuffer, double estimatedDemand, String reason, Instant timestamp) { }