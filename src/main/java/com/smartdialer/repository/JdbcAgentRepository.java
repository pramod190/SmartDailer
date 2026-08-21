package com.smartdialer.repository;

import com.smartdialer.domain.Agent;
import com.smartdialer.domain.AgentState;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.context.annotation.Profile;
import org.springframework.transaction.annotation.Transactional;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

@Repository
@Profile("postgres")
public final class JdbcAgentRepository implements AgentRepository {
    private final JdbcTemplate jdbc;
    public JdbcAgentRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    @Override @Transactional public Optional<Agent> reserveAvailable(String campaignId, Duration lease) {
        UUID id = jdbc.query("SELECT id FROM agents WHERE campaign_id = ? AND state = 'AVAILABLE' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1",
                ps -> ps.setString(1, campaignId), rs -> rs.next() ? UUID.fromString(rs.getString(1)) : null);
        if (id == null) return Optional.empty();
        int changed = jdbc.update("UPDATE agents SET state='RESERVED', version=version+1, lease_expires_at=? WHERE id=? AND state='AVAILABLE'",
                Timestamp.from(Instant.now().plus(lease)), id);
        if (changed != 1) return Optional.empty();
        return find(id);
    }
    @Override public List<Agent> findByCampaign(String campaignId) { return jdbc.query("SELECT id,campaign_id,state,version,lease_expires_at FROM agents WHERE campaign_id=?", this::map, campaignId); }
    @Override public Optional<Agent> find(UUID id) { return jdbc.query("SELECT id,campaign_id,state,version,lease_expires_at FROM agents WHERE id=?", this::map, id).stream().findFirst(); }
    @Override public void save(Agent agent) { jdbc.update("UPDATE agents SET state=?, version=?, lease_expires_at=? WHERE id=?", agent.state().name(), agent.version(), agent.leaseExpiresAt() == null ? null : Timestamp.from(agent.leaseExpiresAt()), agent.id()); }
    @Override public List<Agent> findExpired(Instant now) { return jdbc.query("SELECT id,campaign_id,state,version,lease_expires_at FROM agents WHERE state='RESERVED' AND lease_expires_at < ?", this::map, Timestamp.from(now)); }
    @Override public int recoverExpired(Instant now) { return jdbc.update("UPDATE agents SET state='AVAILABLE', version=version+1, lease_expires_at=NULL WHERE state='RESERVED' AND lease_expires_at < ?", Timestamp.from(now)); }
    private Agent map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        Timestamp lease = rs.getTimestamp("lease_expires_at");
        return new Agent(UUID.fromString(rs.getString("id")), rs.getString("campaign_id"), AgentState.valueOf(rs.getString("state")), rs.getLong("version"), lease == null ? null : lease.toInstant());
    }
}