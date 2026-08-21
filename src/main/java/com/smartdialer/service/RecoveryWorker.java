package com.smartdialer.service;

import com.smartdialer.domain.AgentState;
import com.smartdialer.repository.*;
import com.smartdialer.provider.TelecomProvider;
import java.time.Instant;

public final class RecoveryWorker {
    private final AgentRepository agents;
    private final CallRepository calls;
    private final BorrowerRepository borrowers;
    private final TelecomProvider provider;
    public RecoveryWorker(AgentRepository agents) { this.agents = agents; this.calls = null; this.borrowers = null; this.provider = null; }
    public RecoveryWorker(AgentRepository agents, CallRepository calls, BorrowerRepository borrowers, TelecomProvider provider) {
        this.agents = agents; this.calls = calls; this.borrowers = borrowers; this.provider = provider;
    }
    public int recover(Instant now) {
        if (calls == null || provider == null) return agents.recoverExpired(now);
        EventProcessor events = new EventProcessor(calls, agents, borrowers);
        for (var agent : agents.findExpired(now)) {
            for (var call : calls.all().stream().filter(candidate -> candidate.agentId().equals(agent.id()) && !candidate.state().isTerminal()).toList()) {
                for (var event : provider.pollEvents(call.id())) events.process(call.id(), event);
                if (calls.find(call.id()).orElseThrow().state().isTerminal()) continue;
                if (provider.cancelCall(call.id())) events.process(call.id(), "recovery-cancel:" + call.id(), com.smartdialer.domain.ProviderEventType.CANCELLED);
            }
        }
        return agents.recoverExpired(now);
    }
    public boolean isRecoverable(AgentState state) { return state == AgentState.RESERVED; }
}