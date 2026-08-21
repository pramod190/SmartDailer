# Failure Demonstrations

The executable test suite is the deterministic failure demonstration. Run:

```bash
mvn clean test
```

The scenarios are covered by `P0DomainTest`:

| Scenario | Demonstration | Expected result |
| --- | --- | --- |
| Worker crash | Expired `RESERVED` agent with an `INITIATED` call | Recovery cancels the uncertain call, releases the agent and borrower, and does not retry blindly |
| Provider outage | Provider health is `UNHEALTHY` | Safety rejects new calls; existing call state remains event-driven |
| Agent drop | Simulation scenario D removes 8 of 20 agents before pacing | Available capacity and requested calls decrease immediately |
| Duplicate events | Provider B emits two `ANSWERED` events | Only the first effective transition is applied |
| Out-of-order events | Provider B emits `COMPLETED`, then `ANSWERED`, then late `RINGING` | The call remains terminal and resources are released once |

The provider failure test uses an admitted provider that fails every initiation. It makes exactly three attempts for one call, then marks it `FAILED` and makes both resources reusable. The simulation also introduces 80 ms provider latency and a 35% failure rate in scenario D.