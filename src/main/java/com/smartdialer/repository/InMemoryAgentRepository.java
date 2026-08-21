package com.smartdialer.repository;

import com.smartdialer.domain.Agent;
import com.smartdialer.domain.AgentState;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public final class InMemoryAgentRepository implements AgentRepository {
    private final Map<UUID, Agent> agents = new ConcurrentHashMap<>();
    public void add(Agent agent) { agents.put(agent.id(), agent); }
    @Override public Optional<Agent> reserveAvailable(String campaignId, Duration lease) {
        for (Agent agent : agents.values()) {
            if (agent.campaignId().equals(campaignId) && agent.state() == AgentState.AVAILABLE) {
                synchronized (agent) {
                    if (agent.state() == AgentState.AVAILABLE) {
                        agent.transitionTo(AgentState.RESERVED); agent.leaseUntil(Instant.now().plus(lease)); return Optional.of(agent);
                    }
                }
            }
        }
        return Optional.empty();
    }
    @Override public List<Agent> findByCampaign(String campaignId) { return agents.values().stream().filter(a -> a.campaignId().equals(campaignId)).toList(); }
    @Override public Optional<Agent> find(UUID id) { return Optional.ofNullable(agents.get(id)); }
    @Override public void save(Agent agent) { agents.put(agent.id(), agent); }
    @Override public List<Agent> findExpired(Instant now) { return agents.values().stream().filter(a -> a.state() == AgentState.RESERVED && a.leaseExpired(now)).toList(); }
    @Override public int recoverExpired(Instant now) {
        int count = 0;
        for (Agent agent : agents.values()) if (agent.state() == AgentState.RESERVED && agent.leaseExpired(now)) { agent.transitionTo(AgentState.AVAILABLE); count++; }
        return count;
    }
}