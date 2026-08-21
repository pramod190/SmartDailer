package com.smartdialer.service;

import com.smartdialer.domain.ProviderEventType;
import com.smartdialer.domain.ProviderEvent;
import com.smartdialer.domain.AgentState;
import com.smartdialer.repository.*;
import java.util.UUID;

public final class EventProcessor {
    private final CallRepository calls;
    private final AgentRepository agents;
    private final BorrowerRepository borrowers;
    public EventProcessor(CallRepository calls) { this(calls, null, null); }
    public EventProcessor(CallRepository calls, AgentRepository agents, BorrowerRepository borrowers) { this.calls = calls; this.agents = agents; this.borrowers = borrowers; }
    public boolean process(UUID callId, String eventId, ProviderEventType event) {
        return calls.find(callId).map(call -> {
            boolean changed = call.applyEvent(eventId, event); calls.save(call);
            if (changed && call.state().isTerminal()) releaseResources(call);
            return changed;
        }).orElse(false);
    }
    public boolean process(UUID callId, ProviderEvent event) { return process(callId, event.eventId(), event.type()); }
    private void releaseResources(com.smartdialer.domain.Call call) {
        if (agents != null) agents.find(call.agentId()).ifPresent(agent -> {
            if (agent.state() == AgentState.RESERVED || agent.state() == AgentState.DIALING) agent.transitionTo(AgentState.AVAILABLE);
            else if (agent.state() == AgentState.CONNECTED) { agent.transitionTo(AgentState.WRAP_UP); agent.transitionTo(AgentState.AVAILABLE); }
            agents.save(agent);
        });
        if (borrowers != null) borrowers.release(call.borrowerId());
    }
}