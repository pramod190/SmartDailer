package com.smartdialer.simulation;

import com.smartdialer.domain.*;
import com.smartdialer.provider.ReliableMockProvider;
import com.smartdialer.provider.TelecomProvider;
import com.smartdialer.repository.*;
import com.smartdialer.service.*;

public final class Simulation {
    public static void main(String[] args) {
        run("A", 20, 120, 10, 0, 0); run("B", 50, 90, 20, 0, 0); run("C", 70, 180, 40, 0, 0); run("D", 10, 240, 80, .35, 8);
    }
    private static void run(String name, double answerRate, double talkTime, long latency, double failureRate, int churn) {
        InMemoryAgentRepository agents = new InMemoryAgentRepository(); InMemoryBorrowerRepository borrowers = new InMemoryBorrowerRepository();
        InMemoryCallRepository calls = new InMemoryCallRepository();
        for (int i = 0; i < 20; i++) { Agent agent = new Agent(java.util.UUID.randomUUID(), name, AgentState.AVAILABLE); agents.add(agent); borrowers.add(name, "borrower-" + i); if (i < churn) agent.transitionTo(AgentState.OFFLINE); }
        TelecomProvider provider = failureRate > 0 ? new com.smartdialer.provider.UnreliableMockProvider(failureRate, latency) : new ReliableMockProvider(latency);
        int available = 20 - churn; PacingDecision pacing = new PacingEngine().decide(available, 0, 0, answerRate / 100, talkTime, provider.getHealth());
        var dialer = new ProgressiveDialer(agents, borrowers, calls, provider); var result = dialer.dial(name, pacing.requestedCalls(), 20);
        int connected = 0, completed = 0, failed = 0;
        for (Call call : result) for (ProviderEvent event : provider.pollEvents(call.id())) { if (event.type() == ProviderEventType.CONNECTED) connected++; if (event.type() == ProviderEventType.COMPLETED) completed++; dialer.events().process(call.id(), event); }
        for (Call call : result) if (call.state() == CallState.FAILED) failed++;
        String safety = pacing.requestedCalls() == 0 ? "REJECT" : (result.size() < pacing.requestedCalls() ? "REDUCE" : "APPROVE");
        double utilization = (double) connected / Math.max(1, available);
        System.out.printf("Scenario %s: answerRate=%.0f%% talkTime=%.0fs latency=%dms failures=%.0f%% churn=%d available=%d requested=%d initiated=%d connected=%d completed=%d failed=%d utilization=%.0f%% safety=%s reason=%s%n", name, answerRate, talkTime, latency, failureRate * 100, churn, available, pacing.requestedCalls(), result.size(), connected, completed, failed, utilization * 100, safety, pacing.reason());
    }
}