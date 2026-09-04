# SmartDialer — Senior Staff Engineering Interview Preparation

This document prepares the engineering team to explain every architectural decision, concurrency nuance, distributed systems trade-off, and edge-case mitigation implemented in SmartDialer.

---

### Q1: What is the core engineering challenge in an outbound dialer?
**Answer**:
The challenge is managing **probabilistic customer behavior with deterministic resource constraints**.
When dialing a phone number, whether the borrower answers is probabilistic (e.g., 20%–50% answer rate) with 15–30 seconds of ringing latency. However, agent availability is a hard, deterministic constraint: an agent can only handle one customer at a time.
* If you dial 1 call per agent (**Progressive**), agents spend 70% of their time listening to ringtones, killing center productivity.
* If you overdial (**Predictive**), any sudden cluster of answers when agents are occupied creates **abandoned calls** (illegal under FTC/TCPA regulations if > 3%).
SmartDialer solves this by decoupling predictive overdialing from an independent, non-bypassable **Safety Controller** and atomic reservation layer.

---

### Q2: Why did you separate Phase 1 (DB transaction) from Phase 2 (Provider RPC)?
**Answer**:
This represents the fundamental **distributed systems boundary**.
A database transaction locks rows or tables. A telecom provider RPC involves an external HTTP/SIP network round-trip that takes between 50ms and 2000ms. If you hold a database transaction open during an external network call:
1. Database connection pools are rapidly exhausted.
2. Other workers waiting for row locks time out.
3. If the carrier hangs or experiences latency jitter, the entire database deadlocks.

SmartDialer reserves resources in the database in **sub-millisecond time (< 1ms)** and commits immediately. The external RPC occurs strictly outside the transaction. If the RPC fails or times out, a compensating transaction cleanly releases the agent and reschedules the borrower with exponential backoff.

---

### Q3: How do you prevent double-reservations when 100 workers compete for 1 agent?
**Answer**:
We use **optimistic concurrency control (OCC)** via an integer `version` column and atomic conditional updates:
```sql
UPDATE agents
SET state = 'RESERVED', version = version + 1, reserved_at = :now, current_call_id = :callId
WHERE id = :agentId AND state = 'AVAILABLE' AND version = :expectedVersion;
```
When 100 concurrent workers attempt this query simultaneously:
1. The database's atomic write-lock processes the first worker's update. The version increments from `1` to `2`. Exactly 1 row is modified (`changes === 1`).
2. The remaining 99 workers execute against version `1`, but the row version is now `2` (and state is no longer `'AVAILABLE'`). Their queries match 0 rows (`changes === 0`).
3. Each losing worker receives `false`, immediately releases any intermediate state, and selects another candidate.
This is verified by our concurrency test suite (`tests/concurrency/agent-reservation.test.ts`), where 100 workers attempting to claim 1 agent results in exactly 1 reservation.

---

### Q4: What happens if a dialer worker crashes after reserving an agent but before calling the provider?
**Answer**:
This is the **orphaned reservation** failure mode.
When an agent is reserved, we record `reserved_at = now()`.
The `StaleReservationRecovery` component runs periodically. If an agent has been in `RESERVED` state for longer than `leaseTimeoutSec` (default 30 seconds):
1. It reclaims the agent back to `AVAILABLE` using optimistic locking (`version = version + 1`).
2. It transitions the associated call to `FAILED` with `failureReason = 'stale_reservation_timeout'`.
3. It releases the borrower with exponential backoff so the customer is not permanently locked.

---

### Q5: How do you handle out-of-order and duplicate provider webhooks?
**Answer**:
We use a **three-layer event ingestion pipeline**:
1. **Idempotency Guard**: Every webhook event carries a unique `eventId`. The database enforces a `UNIQUE(provider_name, event_id)` constraint. Duplicate events are silently acknowledged and dropped.
2. **Event Ordering Guard**: Providers assign monotonically increasing `sequenceNumber` to call lifecycle events. We store `last_provider_sequence` on the call record. If an event arrives with sequence $\le$ `last_provider_sequence`, it is identified as a delayed/stale packet and dropped.
3. **Finite State Machine Protection**: The `CallStateMachine` enforces directed acyclic progression. Once a call reaches a terminal state (`COMPLETED`, `FAILED`, `CANCELLED`), no subsequent event can reopen it. If carrier delivers `RINGING` after `COMPLETED`, the FSM rejects the transition.

---

### Q6: What formula does your Predictive Dialer use?
**Answer**:
We calculate pacing based on rolling statistical answer rates:
$$\text{RawCalls} = \left\lceil \frac{\text{AvailableAgents}}{\max(R_{answer}, R_{min})} \right\rceil$$
Where:
- $R_{answer}$ is the rolling average answer rate over the last $W$ calls (default 100).
- $R_{min}$ is the floor (default 0.15) to prevent division by zero or infinite overdialing during low answer periods.
- We then subtract currently in-flight pending calls ($\text{Calls}_{active} = \text{Reserved} + \text{Initiated} + \text{Ringing}$) to avoid queue accumulation.
- The result is passed to the `SafetyController` which clamps the volume to $\le 1.5\times$ available agents and verifies the abandonment budget.

---

### Q7: Why is the Safety Controller independent from the Pacing Engine?
**Answer**:
Because in safety-critical systems, **the component that optimizes performance should never be the component that enforces safety**.
If pacing algorithms are tuned to be aggressive or use complex ML models, software regressions, data drift, or edge-case inputs could produce catastrophic overdial bursts.
By giving the `SafetyController` complete, independent veto power:
- The pacing engine can only request calls; it cannot dial them.
- Even if the predictive model requests 1,000 calls for 5 agents, the Safety Controller limits the allocation to safe headroom.
- If the carrier health degrades, the Safety Controller forces an instant progressive fallback.

---

### Q8: How does your system comply with FTC/TCPA abandonment regulations?
**Answer**:
US federal regulations require that an outbound dialer abandon no more than 3% of answered calls across a campaign.
SmartDialer computes rolling abandonment:
$$\text{AbandonmentRate} = \frac{\text{Calls Abandoned}}{\text{Total Calls Answered}}$$
If this rate approaches or exceeds `maxAbandonRate` (0.03 / 3%), the Safety Controller immediately drops overdialing to 1.0 (Progressive 1:1 mode) and reserves safety buffers until the rolling metric drops safely below the threshold.

---

### Q9: How would this architecture scale in a multi-node production deployment?
**Answer**:
1. **Application Tier**: The Node.js Express service and Dialer Workers are stateless. You can run 20 worker pods behind a load balancer.
2. **Database Tier**: Migrate to PostgreSQL with a connection pooler (PgBouncer).
3. **Queue Dequeuing**: Replace priority sorting with PostgreSQL's row-level queueing primitive:
   ```sql
   SELECT id FROM borrowers
   WHERE status = 'eligible' AND campaign_id = $1
   ORDER BY priority DESC, created_at ASC
   LIMIT $2
   FOR UPDATE SKIP LOCKED;
   ```
   `SKIP LOCKED` allows dozens of concurrent dialer workers to dequeue separate borrower records with zero contention and zero lock waits.
4. **Cache/Coordination Tier**: Use Redis for distributed distributed lease renewal and real-time counter metrics.

---

### Q10: What are your load test results and bottlenecks?
**Answer**:
Under benchmarking (`npm run loadtest`):
- Pacing calculations take **0.13ms (p50)** and **0.57ms (p99)** at 100 agents, and **0.35ms (p50)** at 1,000 agents.
- Allocation throughput reaches **3,800+ operations/second** on a single node.
- The primary bottleneck in SQLite at 10,000 agents is disk write throughput on the WAL file during bulk insertions. In production PostgreSQL, partitioned tables on `calls` and `borrowers` along with unlogged staging tables resolve this bottleneck.
