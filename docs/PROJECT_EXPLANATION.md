# SmartDialer Project Explanation

## 1. Project Overview

SmartDialer is a functional prototype for improving collections-agent utilization while preserving deterministic call safety.

In a traditional progressive dialer, the system creates one outbound call for each available agent. This approach is safe and predictable, but agents may spend time waiting for calls to connect. A predictive dialer can start additional calls based on estimated answer rates and call durations, but it can create a compliance and customer-experience problem when more borrowers answer than available agents can handle.

SmartDialer combines predictive pacing with a mandatory Safety Controller. The pacing engine estimates how many calls may be useful, but it cannot directly call a telecom provider. The Safety Controller independently validates and limits every request before the Call Allocator reserves resources and contacts a provider.

## 2. Main Objectives

The project is designed to guarantee the following:

- An agent cannot be allocated to multiple active calls.
- A borrower cannot be allocated to multiple active calls.
- Active agent-bound calls never exceed safe agent capacity.
- Invalid agent and call state transitions are rejected.
- Terminal calls cannot return to active states.
- Duplicate provider events do not create duplicate side effects.
- Out-of-order provider events cannot corrupt call state.
- Provider failures cannot cause unlimited retries or new calls.
- Worker crashes do not permanently lock agents or borrowers.
- Pacing decisions are explainable.

## 3. Technology Stack

- Java 21
- Spring Boot 3.3
- Maven
- PostgreSQL repository support
- Flyway database migration
- JUnit 5 tests
- In-memory repositories for deterministic demonstrations
- Mock telecom providers

The project is intentionally implemented as a modular monolith. This keeps the prototype easy to run, test, and explain without introducing unnecessary Kafka, Redis, Kubernetes, or microservice infrastructure.

## 4. Architecture

The main processing flow is:

```text
Campaign
   |
   v
Predictive Pacing Engine
   |
   v
Safety Controller
   |
   v
Progressive Call Allocator
   |
   v
Telecom Provider
  / \
Mock Provider A   Mock Provider B
```

The database stores durable agent, borrower, call, provider-event, health, pacing, and safety information. Provider events are processed by the event processor. A recovery worker handles stale reservations after worker failures.

## 5. Predictive Pacing Engine

The PacingEngine produces a PacingDecision. It does not place calls.

The decision considers:

- Available agents
- Connected calls
- Ringing calls
- Historical answer rate
- Average talk time
- Provider health
- A safety buffer

The prototype estimates demand using a simple rule-based formula. Higher answer rates and longer talk times increase estimated demand. The engine reduces or stops requests when the provider is degraded or unhealthy.

Each decision contains the requested call count and a reason. For example:

```text
available=20, demand=7.50, buffer=3
```

This makes it possible to explain why the system requested a particular number of calls.

## 6. Safety Controller

The SafetyController is the final authority before dialing. It receives a pacing request and independently calculates safe capacity.

It considers:

- Available agents
- Reserved agents
- Dialing calls
- Connected calls
- Ringing calls
- Stale reservations
- Campaign limits
- Recent failures
- Answer rate
- Provider health

The controller can return:

- APPROVE: the complete request is safe.
- REDUCE: only a smaller number is safe.
- REJECT: no new calls may be created.
- FALLBACK_PROGRESSIVE: the system should behave conservatively.

The ProgressiveDialer cannot bypass this controller. This is the central safety boundary of the project.

## 7. Progressive Dialer Workflow

The ProgressiveDialer follows these steps:

1. Count currently available agents and active calls.
2. Ask the SafetyController for approved capacity.
3. Atomically reserve one available agent.
4. Atomically reserve one eligible borrower.
5. Create a call in the RESERVED state.
6. Move the call to INITIATED.
7. Commit the internal reservation before contacting the provider.
8. Attempt provider initiation at most three times.
9. Move the agent to DIALING only when the provider accepts the call.
10. Process provider events.
11. Release the agent and borrower when the call reaches a terminal state.

The database transaction is kept short. It does not remain open while waiting for the external telecom provider.

## 8. Agent State Machine

Agents use explicit states:

```text
OFFLINE -> AVAILABLE
AVAILABLE -> RESERVED
AVAILABLE -> PAUSED
AVAILABLE -> OFFLINE
RESERVED -> DIALING
RESERVED -> AVAILABLE
RESERVED -> OFFLINE
DIALING -> CONNECTED
DIALING -> AVAILABLE
DIALING -> OFFLINE
CONNECTED -> WRAP_UP
WRAP_UP -> AVAILABLE
PAUSED -> AVAILABLE
PAUSED -> OFFLINE
```

Agent state cannot be changed by arbitrary field mutation. Every transition passes through the state-machine logic. Invalid transitions throw an error.

## 9. Call State Machine

Calls use explicit lifecycle states:

```text
QUEUED -> RESERVED -> INITIATED -> RINGING -> ANSWERED -> CONNECTED -> COMPLETED
```

Failure and cancellation can occur at appropriate points:

```text
QUEUED -> CANCELLED
RESERVED -> CANCELLED or FAILED
INITIATED -> FAILED or CANCELLED
RINGING -> FAILED, CANCELLED, or COMPLETED
ANSWERED -> FAILED or COMPLETED
CONNECTED -> FAILED or COMPLETED
```

COMPLETED, FAILED, and CANCELLED are terminal states. A terminal call cannot return to ANSWERED, RINGING, or any other active state.

## 10. Concurrent Allocation

The in-memory repository uses synchronized access on the individual agent object. This prevents two local threads from successfully reserving the same agent.

The PostgreSQL repository uses database-level protection:

- `FOR UPDATE SKIP LOCKED` selects an eligible agent row.
- A conditional update changes AVAILABLE to RESERVED.
- The version column is incremented.
- The reservation lease receives an expiry time.

This means the database, rather than a JVM-local lock, decides which worker wins. The same principle is applied to borrowers through atomic reservation operations.

The concurrency test starts 100 workers against one available agent and expects exactly one successful reservation.

## 11. Provider Abstraction

The dialer depends only on the TelecomProvider interface:

- initiateCall()
- cancelCall()
- getHealth()
- pollEvents()

Provider A is fast and reliable. Provider B is slower and simulates duplicate and out-of-order events. The dialer does not contain provider-specific implementation logic.

## 12. Duplicate and Out-of-Order Events

Every provider event has an event identity. The Call object records processed event identities and ignores duplicates.

For example, repeated ANSWERED events result in only one effective transition.

If COMPLETED arrives before ANSWERED or RINGING, the call moves to COMPLETED. Later ANSWERED and RINGING events are ignored because the call is already terminal.

This protects the system from webhook retries, network delays, and provider ordering problems.

## 13. Provider Outage and Retry Handling

Provider health has three conceptual levels:

```text
HEALTHY -> DEGRADED -> UNHEALTHY
```

The ProviderHealthTracker changes health based on consecutive failures:

- One failure: remains HEALTHY.
- Two or more failures: DEGRADED.
- Five or more consecutive failures: UNHEALTHY.
- A success resets the provider to HEALTHY.

When a provider is unhealthy:

- New calls are rejected by the SafetyController.
- Pacing requests become zero or highly conservative.
- Existing calls continue based on their current state and future provider events.
- Retries are bounded at three attempts per call.

The system never blindly retries indefinitely.

## 14. Worker Crash Recovery

A reservation receives a lease expiry time. If a worker crashes after reserving an agent and borrower, the reservation eventually becomes stale.

The RecoveryWorker:

1. Finds expired reserved agents.
2. Finds active calls associated with those agents.
3. Polls the provider for events.
4. Applies any discovered events idempotently.
5. Cancels the provider call if it is still active or uncertain.
6. Releases the borrower and agent through normal terminal cleanup.
7. Allows future work only after reconciliation.

The system does not blindly create a second call after a crash because the provider may already have received the first initiation request.

## 15. Simulation

The Simulation class runs four scenarios:

| Scenario | Answer Rate | Talk Time | Additional Conditions |
| --- | ---: | ---: | --- |
| A | 20% | 120 seconds | 10 ms provider latency |
| B | 50% | 90 seconds | 20 ms provider latency |
| C | 70% | 180 seconds | 40 ms provider latency; safety rejects new calls |
| D | 10% | 240 seconds | 80 ms latency, 35% failures, and 8 agents unavailable |

The output includes:

- Available agents
- Requested calls
- Initiated calls
- Connected calls
- Completed calls
- Failed calls
- Agent utilization
- Safety decision
- Pacing explanation

## 16. Load Test

The LoadTest class evaluates reservation operations for:

- 100 agents
- 1,000 agents
- 10,000 agents

It reports elapsed time and reservation throughput. The first bottleneck in the simple prototype is the cost of scanning and contending over available agents. In a larger deployment, indexed database updates, `SKIP LOCKED`, campaign partitioning, and controlled worker concurrency would be used before adding more servers.

## 17. Testing

The test suite includes 13 tests covering:

- Valid and invalid agent transitions
- Valid and invalid call transitions
- Terminal call protection
- Duplicate provider events
- Out-of-order provider events
- 100 workers competing for one agent
- 100 workers competing for one borrower
- Progressive capacity limits
- Safety reduction and provider rejection
- Predictive pacing
- Provider health transitions
- Bounded provider retries
- Lease recovery
- Worker-crash reconciliation
- End-to-end provider event processing

## 18. How to Run

From the project root:

```cmd
set "JAVA_HOME=C:\path\to\jdk-21"
set "PATH=%JAVA_HOME%\bin;C:\path\to\apache-maven\bin;%PATH%"
mvn clean test
mvn spring-boot:run
```

Run the simulation:

```cmd
java -cp target\classes com.smartdialer.simulation.Simulation
```

Run the load test:

```cmd
java -cp target\classes com.smartdialer.simulation.LoadTest
```

## 19. Conclusion

SmartDialer uses prediction for utilization but uses deterministic safety for authorization. The pacing engine can suggest more calls, but it cannot bypass the SafetyController. Atomic resource allocation, explicit state machines, idempotent provider events, provider health, bounded retries, and lease-based recovery make the prototype explainable and failure-aware.

The main production extensions would be a complete PostgreSQL implementation for all repositories, database integration tests, real provider adapters, operational metrics, and distributed campaign workers. Those additions can scale the design without changing its central safety boundary.
