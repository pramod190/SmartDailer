# Architecture Decision Records

## ADR-001: Modular monolith
**Context:** The assignment is time-boxed and the workflow has transactional boundaries. **Decision:** Keep pacing, safety, allocation, and event handling in one deployable Java application. **Reason:** Fast feedback and simple debugging. **Trade-off:** Components scale together until extracted.

## ADR-002: PostgreSQL
**Context:** Reservations and event idempotency need durable constraints. **Decision:** PostgreSQL with Flyway migrations. **Reason:** Conditional updates, row locks, partial indexes, and transactional semantics are mature. **Trade-off:** A database is required for production deployment.

## ADR-003: Optimistic/versioned allocation with row locking
**Context:** Multiple workers can target the same agent. **Decision:** Select an eligible row with `SKIP LOCKED`, then conditionally update its available state and version. **Reason:** Database, not JVM memory, arbitrates ownership. **Trade-off:** Contention can return no reservation and callers must retry the campaign loop.

## ADR-004: Independent Safety Controller
**Context:** Predictions can be wrong. **Decision:** Safety is a separate final authority. **Reason:** It prevents pacing errors from violating agent/call limits. **Trade-off:** Some theoretical utilization is intentionally sacrificed.

## ADR-005: Rule/statistical pacing
**Context:** The prototype needs explainability. **Decision:** Estimate demand from answer rate, talk time, active calls, and provider health with a buffer. **Reason:** Every decision has a human-readable reason. **Trade-off:** It is less adaptive than a trained model.

## ADR-006: Provider abstraction
**Context:** Provider behavior varies and must be simulated. **Decision:** Depend on `TelecomProvider` and provide reliable/unreliable mocks. **Reason:** Provider-specific behavior stays at the boundary. **Trade-off:** A real adapter still needs operational work.

## ADR-007: Idempotent events
**Context:** Webhooks may duplicate or arrive late. **Decision:** Persist event identities and ignore repeats or backward transitions. **Reason:** State updates become retry-safe. **Trade-off:** Event storage and reconciliation are required.

## ADR-008: Leases and recovery
**Context:** A worker can die after reserving resources. **Decision:** Reservations expire and a recovery worker examines state before release/retry. **Reason:** Prevents permanent locks without blindly duplicating provider calls. **Trade-off:** Lease duration is a tuning parameter.

## ADR-009: No Kafka/Redis/microservices
**Context:** The assignment prioritizes correctness over infrastructure. **Decision:** Use database state and local orchestration. **Reason:** Fewer moving parts and a clear interview-sized prototype. **Trade-off:** High-volume event fan-out would eventually need a durable queue and partitioning.