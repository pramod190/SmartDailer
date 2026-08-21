package com.smartdialer;

import com.smartdialer.domain.*;
import com.smartdialer.provider.*;
import com.smartdialer.repository.*;
import com.smartdialer.service.*;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class P0DomainTest {
    @Test void agentTransitionsRejectInvalidEdges() {
        Agent agent = new Agent(UUID.randomUUID(), "c", AgentState.OFFLINE);
        agent.transitionTo(AgentState.AVAILABLE); agent.transitionTo(AgentState.RESERVED); agent.transitionTo(AgentState.DIALING);
        assertThrows(IllegalStateException.class, () -> agent.transitionTo(AgentState.PAUSED));
    }

    @Test void terminalCallIgnoresDuplicatesAndOldEvents() {
        Call call = new Call(UUID.randomUUID(), UUID.randomUUID(), "b");
        call.moveTo(CallState.RESERVED); call.moveTo(CallState.INITIATED);
        assertTrue(call.applyEvent("r", ProviderEventType.RINGING));
        assertTrue(call.applyEvent("done", ProviderEventType.COMPLETED));
        assertFalse(call.applyEvent("answered", ProviderEventType.ANSWERED));
        assertFalse(call.applyEvent("ringing-again", ProviderEventType.RINGING));
        assertEquals(CallState.COMPLETED, call.state());
    }

    @Test void invalidProviderEventCannotSkipCallStates() {
        Call call = new Call(UUID.randomUUID(), UUID.randomUUID(), "b");
        call.moveTo(CallState.RESERVED); call.moveTo(CallState.INITIATED);
        assertFalse(call.applyEvent("answered-too-early", ProviderEventType.ANSWERED));
        assertEquals(CallState.INITIATED, call.state());
    }

    @Test void oneHundredWorkersReserveOneAgent() throws Exception {
        InMemoryAgentRepository repository = new InMemoryAgentRepository();
        repository.add(new Agent(UUID.randomUUID(), "c", AgentState.AVAILABLE));
        ExecutorService pool = Executors.newFixedThreadPool(20);
        CountDownLatch start = new CountDownLatch(1); List<Future<Boolean>> futures = new ArrayList<>();
        for (int i = 0; i < 100; i++) futures.add(pool.submit(() -> { start.await(); return repository.reserveAvailable("c", Duration.ofMinutes(1)).isPresent(); }));
        start.countDown(); long successes = 0;
        for (Future<Boolean> future : futures) if (future.get()) successes++;
        pool.shutdownNow(); assertEquals(1, successes);
    }

    @Test void safetyReducesAndRejectsRequests() {
        ReliableMockProvider provider = new ReliableMockProvider(); SafetyController safety = new SafetyController(provider);
        assertEquals(SafetyDecision.Decision.REDUCE, safety.authorize(15, 8, 0, 0, 0, 0, 0, 50, 0, .5).decision());
        provider.setHealth(ProviderHealth.UNHEALTHY);
        assertEquals(SafetyDecision.Decision.REJECT, safety.authorize(1, 8, 0, 0, 0, 0, 0, 50, 0, .5).decision());
    }

    @Test void progressiveDialerNeverExceedsAgents() {
        InMemoryAgentRepository agents = new InMemoryAgentRepository(); InMemoryBorrowerRepository borrowers = new InMemoryBorrowerRepository(); InMemoryCallRepository calls = new InMemoryCallRepository();
        for (int i = 0; i < 3; i++) { agents.add(new Agent(UUID.randomUUID(), "c", AgentState.AVAILABLE)); borrowers.add("c", "b" + i); }
        List<Call> created = new ProgressiveDialer(agents, borrowers, calls, new ReliableMockProvider()).dial("c", 20, 20);
        assertEquals(3, created.size()); assertEquals(3, agents.findByCampaign("c").stream().filter(a -> a.state() == AgentState.DIALING).count());
    }

    @Test void pacingIsConservativeWhenProviderIsUnhealthy() {
        PacingDecision decision = new PacingEngine().decide(20, 3, 2, .5, 120, ProviderHealth.UNHEALTHY);
        assertEquals(0, decision.requestedCalls()); assertTrue(decision.reason().contains("demand"));
    }

    @Test void expiredReservationIsRecovered() {
        InMemoryAgentRepository repository = new InMemoryAgentRepository(); Agent agent = new Agent(UUID.randomUUID(), "c", AgentState.AVAILABLE); repository.add(agent);
        repository.reserveAvailable("c", Duration.ZERO); assertEquals(1, repository.recoverExpired(Instant.now().plusSeconds(1))); assertEquals(AgentState.AVAILABLE, agent.state());
    }

    @Test void oneHundredWorkersReserveOneBorrower() throws Exception {
        InMemoryBorrowerRepository repository = new InMemoryBorrowerRepository(); repository.add("c", "borrower");
        ExecutorService pool = Executors.newFixedThreadPool(20); CountDownLatch start = new CountDownLatch(1); List<Future<Boolean>> futures = new ArrayList<>();
        for (int i = 0; i < 100; i++) futures.add(pool.submit(() -> { start.await(); return repository.reserveEligible("c").isPresent(); }));
        start.countDown(); long successes = 0; for (Future<Boolean> future : futures) if (future.get()) successes++;
        pool.shutdownNow(); assertEquals(1, successes);
    }

    @Test void providerFailureRetriesThreeTimesAndReleasesResources() {
        InMemoryAgentRepository agents = new InMemoryAgentRepository(); InMemoryBorrowerRepository borrowers = new InMemoryBorrowerRepository(); InMemoryCallRepository calls = new InMemoryCallRepository();
        Agent agent = new Agent(UUID.randomUUID(), "c", AgentState.AVAILABLE); agents.add(agent); borrowers.add("c", "b");
        int[] attempts = {0};
        TelecomProvider provider = new TelecomProvider() {
            public ProviderCallResult initiateCall(UUID callId, String borrowerId) { attempts[0]++; return new ProviderCallResult(false, "failed-" + callId, ProviderEventType.FAILED, "outage"); }
            public boolean cancelCall(UUID callId) { return true; }
            public ProviderHealth getHealth() { return ProviderHealth.HEALTHY; }
        };
        List<Call> created = new ProgressiveDialer(agents, borrowers, calls, provider).dial("c", 1, 1);
        assertEquals(1, created.size()); assertEquals(3, attempts[0]); assertEquals(CallState.FAILED, created.get(0).state());
        assertEquals(AgentState.AVAILABLE, agent.state()); assertTrue(borrowers.reserveEligible("c").isPresent());
    }

    @Test void unreliableProviderEventsRemainTerminalAndIdempotent() {
        InMemoryAgentRepository agents = new InMemoryAgentRepository(); InMemoryBorrowerRepository borrowers = new InMemoryBorrowerRepository(); InMemoryCallRepository calls = new InMemoryCallRepository();
        agents.add(new Agent(UUID.randomUUID(), "c", AgentState.AVAILABLE)); borrowers.add("c", "b");
        UnreliableMockProvider provider = new UnreliableMockProvider(0); ProgressiveDialer dialer = new ProgressiveDialer(agents, borrowers, calls, provider);
        Call call = dialer.dial("c", 1, 1).get(0);
        for (ProviderEvent event : provider.pollEvents(call.id())) dialer.events().process(call.id(), event);
        assertEquals(CallState.COMPLETED, call.state()); assertEquals(AgentState.AVAILABLE, agents.findByCampaign("c").get(0).state());
    }

    @Test void recoveryCancelsInitiatedCallAfterWorkerCrash() {
        InMemoryAgentRepository agents = new InMemoryAgentRepository(); InMemoryBorrowerRepository borrowers = new InMemoryBorrowerRepository(); InMemoryCallRepository calls = new InMemoryCallRepository();
        Agent agent = new Agent(UUID.randomUUID(), "c", AgentState.AVAILABLE); agents.add(agent); borrowers.add("c", "b");
        agents.reserveAvailable("c", Duration.ZERO); Call call = new Call(UUID.randomUUID(), agent.id(), "b"); call.moveTo(CallState.RESERVED); call.moveTo(CallState.INITIATED); calls.save(call);
        RecoveryWorker worker = new RecoveryWorker(agents, calls, borrowers, new ReliableMockProvider());
        worker.recover(Instant.now().plusSeconds(1));
        assertEquals(CallState.CANCELLED, call.state()); assertEquals(AgentState.AVAILABLE, agent.state()); assertTrue(borrowers.reserveEligible("c").isPresent());
    }

    @Test void providerHealthTrackerMovesThroughDegradationStates() {
        ProviderHealthTracker tracker = new ProviderHealthTracker();
        tracker.recordFailure(); assertEquals(ProviderHealth.HEALTHY, tracker.health());
        tracker.recordFailure(); assertEquals(ProviderHealth.DEGRADED, tracker.health());
        tracker.recordFailure(); tracker.recordFailure(); tracker.recordFailure(); assertEquals(ProviderHealth.UNHEALTHY, tracker.health());
        tracker.recordSuccess(); assertEquals(ProviderHealth.HEALTHY, tracker.health());
    }
}