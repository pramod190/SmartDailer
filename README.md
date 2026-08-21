# SmartDialer

A modular-monolith prototype for explainable predictive dialing with progressive safety guarantees.

## Run

Requirements: Java 21 and Maven 3.9+. PostgreSQL is used by the production repository; the standalone demo uses in-memory repositories.

```bash
mvn clean test
mvn spring-boot:run
```

Run the demos after compiling:

```bash
java -cp target/classes com.smartdialer.simulation.Simulation
java -cp target/classes com.smartdialer.simulation.LoadTest
```

The simulation prints answer rate, talk time, provider latency/failure rate, agent churn, requested and initiated calls, connected/completed/failed calls, utilization, pacing reason, and the Safety Controller outcome. The load test covers 100, 1,000, and 10,000 concurrent reservations and reports throughput plus the first bottleneck and its mitigation.

## Architecture

Campaign demand is estimated by `PacingEngine`, but every request goes through `SafetyController`. The controller considers agent capacity, active calls, stale leases, campaign limits, failures, answer rate, and provider health. `ProgressiveDialer` then atomically reserves an agent and borrower, creates a call, commits that short transaction, and only then calls `TelecomProvider`.

See [architecture.mmd](docs/architecture.mmd), [agent-state-machine.mmd](docs/agent-state-machine.mmd), and [call-state-machine.mmd](docs/call-state-machine.mmd).

## Correctness and failure handling

- PostgreSQL allocation uses `FOR UPDATE SKIP LOCKED` plus a conditional state update and version column.
- Agents and calls have explicit transition rules; terminal calls cannot move backward.
- Provider events are idempotent and old/out-of-order events are ignored.
- Leases let a recovery worker release abandoned reservations.
- Unhealthy providers reject new calls; pacing becomes zero and retries are intentionally bounded at the orchestration boundary.
- The central invariant is active agent-bound calls <= safety-approved capacity.

## Tests

`P0DomainTest` covers state transitions, hostile event ordering, 100 concurrent workers against one agent and one borrower, safety reduction/outage behavior, progressive capacity, conservative pacing, provider health transitions, bounded retries, provider event sequences, end-to-end resource release, and lease recovery. Run `docs/FAILURE_DEMONSTRATIONS.md` for the five failure cases.

## Decisions and limitations

The trade-offs are recorded in [ADR.md](docs/ADR.md), with the complete design answer in [FINAL_DESIGN_ANSWER.md](docs/FINAL_DESIGN_ANSWER.md). This prototype does not include REST polish, Kafka, Redis, distributed workers, or production telemetry. The in-memory tests validate the concurrency contract; PostgreSQL integration is represented by the JDBC repository and migration.