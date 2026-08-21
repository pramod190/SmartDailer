package com.smartdialer.repository;

import com.smartdialer.domain.Agent;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AgentRepository {
    Optional<Agent> reserveAvailable(String campaignId, Duration lease);
    List<Agent> findByCampaign(String campaignId);
    Optional<Agent> find(UUID id);
    void save(Agent agent);
    List<Agent> findExpired(Instant now);
    int recoverExpired(Instant now);
}