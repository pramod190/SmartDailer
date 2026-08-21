# Final Design Answer

The dialer gets utilization benefits from prediction without trusting prediction for safety. `PacingEngine` estimates near-term demand from available agents, active calls, answer rate, average talk time, and provider health. It emits a requested count and an explanation, such as the demand and buffer used in the calculation.

That request enters `SafetyController`, which is the only path to dialing. Safety subtracts reserved, dialing, ringing, and connected work from campaign and agent capacity, accounts for stale reservations and recent failures, and rejects unhealthy providers. It can approve, reduce, or reject the request. Therefore a wrong answer-rate estimate cannot create more agent-bound calls than the deterministic capacity allows.

`ProgressiveDialer` uses short database transactions to reserve one agent and one borrower, create a call, and commit. The external provider is called after commit, so database locks are never held across network latency. PostgreSQL row locking and conditional versioned updates ensure that multiple workers cannot reserve one agent. The same uniqueness principle applies to borrowers.

Explicit agent and call state machines reject invalid transitions. Provider events carry identities and are processed idempotently; duplicate events have no second effect, and terminal calls ignore late `ANSWERED` or `RINGING` events. Provider health moves the system from normal pacing to reduced pacing to no new calls. Retries must be bounded and must not blindly repeat an initiation whose delivery is uncertain.

Leases make crashes recoverable. A worker that dies leaves an expiring reservation. Recovery finds the stale reservation, checks whether a provider call exists and what state it reached, then releases resources or reconciles them. It retries only when the initiation is known not to have been accepted, avoiding duplicate calls.

The feedback loop updates answer-rate, talk-time, failure, and provider-health inputs from completed calls. This improves utilization over time, while the independent safety boundary remains deterministic. At larger scale, the next steps would be partitioned campaign workers, an outbox/event queue, stronger provider reconciliation, and metrics, but none is needed to establish the core safety contract here.