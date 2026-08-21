package com.smartdialer.domain;

import java.time.Instant;
import java.util.UUID;

public final class Agent {
    private final UUID id;
    private final String campaignId;
    private AgentState state;
    private long version;
    private Instant leaseExpiresAt;

    public Agent(UUID id, String campaignId, AgentState state) {
        this.id = id; this.campaignId = campaignId; this.state = state;
    }
    public Agent(UUID id, String campaignId, AgentState state, long version, Instant leaseExpiresAt) {
        this(id, campaignId, state); this.version = version; this.leaseExpiresAt = leaseExpiresAt;
    }
    public UUID id() { return id; }
    public String campaignId() { return campaignId; }
    public synchronized AgentState state() { return state; }
    public synchronized long version() { return version; }
    public synchronized Instant leaseExpiresAt() { return leaseExpiresAt; }
    public synchronized void transitionTo(AgentState next) {
        if (!state.canTransitionTo(next)) throw new IllegalStateException("Invalid agent transition: " + state + " -> " + next);
        state = next; version++;
    }
    public synchronized boolean leaseExpired(Instant now) { return leaseExpiresAt != null && leaseExpiresAt.isBefore(now); }
    public synchronized void leaseUntil(Instant expiresAt) { leaseExpiresAt = expiresAt; }
}