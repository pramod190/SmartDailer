# SmartDialer — 5-Minute Live Interactive Demo Script

This script walks an interviewer or reviewer through a complete live demonstration of SmartDialer via curl commands.

---

## 1. Start the Server

In a terminal:
```bash
npm start
```
Expected output:
```
[INFO] SmartDialer listening on 0.0.0.0:3000
[INFO] Database initialized and migrations applied
```

---

## 2. Verify System Health

```bash
curl -s http://localhost:3000/health | jq .
```
Response:
```json
{
  "status": "ok",
  "service": "smart-dialer",
  "timestamp": "2026-09-04T11:45:00.000Z",
  "pacingMode": "progressive"
}
```

---

## 3. Create an Outbound Campaign

Create a predictive campaign with target abandonment rate cap:
```bash
curl -s -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Live Demo Campaign",
    "mode": "predictive",
    "targetAbandonmentRate": 0.03,
    "maxConcurrency": 100
  }' | jq .
```
Note the returned `id` (e.g. `c1a2b3...`). Set it in an environment variable:
```bash
export CAMPAIGN_ID="<paste-id-here>"
```

Activate the campaign:
```bash
curl -s -X PATCH http://localhost:3000/api/campaigns/$CAMPAIGN_ID/status \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}' | jq .
```

---

## 4. Provision Agents

Add 5 available agents to the campaign:
```bash
curl -s -X POST http://localhost:3000/api/campaigns/$CAMPAIGN_ID/agents \
  -H "Content-Type: application/json" \
  -d '{"count": 5, "state": "AVAILABLE"}' | jq .
```

---

## 5. Import Borrower Leads

Import borrower leads with varied priorities:
```bash
curl -s -X POST http://localhost:3000/api/campaigns/$CAMPAIGN_ID/borrowers \
  -H "Content-Type: application/json" \
  -d '{
    "borrowers": [
      {"phoneNumber": "+1-555-0101", "priority": 10},
      {"phoneNumber": "+1-555-0102", "priority": 9},
      {"phoneNumber": "+1-555-0103", "priority": 8},
      {"phoneNumber": "+1-555-0104", "priority": 7},
      {"phoneNumber": "+1-555-0105", "priority": 6},
      {"phoneNumber": "+1-555-0106", "priority": 5},
      {"phoneNumber": "+1-555-0107", "priority": 4},
      {"phoneNumber": "+1-555-0108", "priority": 3}
    ]
  }' | jq .
```

---

## 6. Execute a Dialing Tick

Trigger a dialer tick. In one tick:
1. Pacing calculates capacity.
2. Safety Controller assesses and approves calls.
3. CallAllocator atomically reserves agents & borrowers and places calls.
4. Provider events are processed.

```bash
curl -s -X POST http://localhost:3000/api/campaigns/$CAMPAIGN_ID/tick \
  -H "Content-Type: application/json" \
  -d '{"mode": "progressive"}' | jq .
```

---

## 7. Inspect Real-Time Campaign Metrics & Invariants

```bash
curl -s http://localhost:3000/api/campaigns/$CAMPAIGN_ID/metrics | jq .
```
Response highlights:
- Agent breakdown: How many are `AVAILABLE`, `CONNECTED`, or `WRAP_UP`.
- Call breakdown: Active, Completed, Failed, and measured Abandonment Rate.
- Borrower status: Completed vs Eligible.

---

## 8. Simulate Carrier Event Webhook (Idempotency Test)

Inject a carrier completion webhook:
```bash
curl -s -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "demo-webhook-001",
    "providerCallId": "rel-demo-call",
    "eventType": "RINGING",
    "sequenceNumber": 1,
    "timestamp": "2026-09-04T12:00:00.000Z",
    "payload": {}
  }' | jq .
```

Repeat the exact same curl request:
```bash
curl -s -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "demo-webhook-001",
    "providerCallId": "rel-demo-call",
    "eventType": "RINGING",
    "sequenceNumber": 1,
    "timestamp": "2026-09-04T12:00:00.000Z",
    "payload": {}
  }' | jq .
```
Notice response: `"duplicate": true, "processed": false`. Layer 1 Idempotency Guard immediately dropped the duplicate without database mutation.

---

## 9. Run End-to-End Simulation Benchmark via API

Run a multi-tick stress simulation directly through the REST API:
```bash
curl -s -X POST http://localhost:3000/api/simulation/run \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "predictive",
    "numAgents": 10,
    "numBorrowers": 50,
    "numTicks": 5,
    "providerType": "reliable"
  }' | jq .invariants
```
Output confirms all invariant guarantees:
```json
{
  "noDoubleReservation": true,
  "allCallsTerminal": true,
  "noOrphanedAgents": true,
  "agentCallInvariant": true
}
```
