package com.smartdialer.service;

import com.smartdialer.domain.*;
import com.smartdialer.provider.TelecomProvider;
import com.smartdialer.repository.*;
import java.time.Duration;
import java.util.*;

public final class ProgressiveDialer {
    private final AgentRepository agents;
    private final BorrowerRepository borrowers;
    private final CallRepository calls;
    private final TelecomProvider provider;
    private final SafetyController safety;
    private final EventProcessor events;

    public ProgressiveDialer(AgentRepository agents, BorrowerRepository borrowers, CallRepository calls, TelecomProvider provider) {
        this.agents = agents; this.borrowers = borrowers; this.calls = calls; this.provider = provider;
        this.safety = new SafetyController(provider); this.events = new EventProcessor(calls, agents, borrowers);
    }
    public List<Call> dial(String campaignId, int requested, int campaignLimit) {
        int available = (int) agents.findByCampaign(campaignId).stream().filter(a -> a.state() == AgentState.AVAILABLE).count();
        var campaignAgents = agents.findByCampaign(campaignId);
        int reservedAgents = (int) campaignAgents.stream().filter(a -> a.state() == AgentState.RESERVED).count();
        int staleReservations = (int) campaignAgents.stream().filter(a -> a.state() == AgentState.RESERVED && a.leaseExpired(java.time.Instant.now())).count();
        int dialingCalls = (int) calls.all().stream().filter(c -> c.state() == CallState.INITIATED).count();
        int connectedCalls = (int) calls.all().stream().filter(c -> c.state() == CallState.CONNECTED).count();
        int ringingCalls = (int) calls.all().stream().filter(c -> c.state() == CallState.RINGING).count();
        int recentFailures = (int) calls.all().stream().filter(c -> c.state() == CallState.FAILED).count();
        SafetyDecision decision = safety.authorize(requested, available, reservedAgents, dialingCalls, connectedCalls, ringingCalls, staleReservations, campaignLimit, recentFailures, .5);
        List<Call> created = new ArrayList<>();
        for (int i = 0; i < decision.approvedCalls(); i++) {
            Optional<Agent> agent = agents.reserveAvailable(campaignId, Duration.ofSeconds(30));
            Optional<String> borrower = borrowers.reserveEligible(campaignId);
            if (agent.isEmpty() || borrower.isEmpty()) {
                agent.ifPresent(a -> { a.transitionTo(AgentState.AVAILABLE); agents.save(a); });
                borrower.ifPresent(borrowers::release);
                break;
            }
            Call call = new Call(UUID.randomUUID(), agent.get().id(), borrower.get());
            call.moveTo(CallState.RESERVED); call.moveTo(CallState.INITIATED); calls.save(call);
            TelecomProvider.ProviderCallResult result = null;
            for (int attempt = 1; attempt <= 3; attempt++) {
                result = provider.initiateCall(call.id(), borrower.get());
                if (result.accepted()) break;
            }
            if (result.accepted()) { agent.get().transitionTo(AgentState.DIALING); agents.save(agent.get()); events.process(call.id(), result.providerCallId() + ":ringing", result.initialEvent()); }
            else { events.process(call.id(), result.providerCallId() + ":failed", ProviderEventType.FAILED); }
            created.add(call);
        }
        return created;
    }
    public SafetyController safety() { return safety; }
    public EventProcessor events() { return events; }
}