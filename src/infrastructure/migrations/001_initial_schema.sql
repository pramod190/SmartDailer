-- ============================================================================
-- SmartDialer — Initial Database Schema
-- Migration: 001_initial_schema
-- ============================================================================
-- Design principles:
-- 1. Every mutable entity has a `version` column for optimistic locking
-- 2. Every entity has created_at/updated_at timestamps
-- 3. Foreign keys enforce referential integrity
-- 4. Indexes support the critical query patterns (agent reservation, borrower
--    selection, active call lookup, provider event deduplication)
-- 5. CHECK constraints enforce valid state values at the DB level
-- 6. The schema is PostgreSQL-compatible with minor type changes
-- ============================================================================

-- ----------------------------
-- Campaigns
-- ----------------------------
CREATE TABLE IF NOT EXISTS campaigns (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    mode            TEXT NOT NULL CHECK (mode IN ('progressive', 'predictive')),
    status          TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'active', 'paused', 'completed', 'cancelled')),
    config_json     TEXT NOT NULL DEFAULT '{}',    -- Campaign-specific overrides (JSON)
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------
-- Agents
-- ----------------------------
CREATE TABLE IF NOT EXISTS agents (
    id                  TEXT PRIMARY KEY,
    campaign_id         TEXT NOT NULL REFERENCES campaigns(id),
    state               TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (state IN (
                            'OFFLINE', 'AVAILABLE', 'RESERVED', 'DIALING',
                            'CONNECTED', 'WRAP_UP', 'PAUSED'
                        )),
    version             INTEGER NOT NULL DEFAULT 1,
    reserved_at         TEXT,                       -- When agent was reserved (lease start)
    last_heartbeat_at   TEXT,
    current_call_id     TEXT,                       -- FK added after calls table exists
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index: find available agents for a campaign (the hot path for reservation)
CREATE INDEX IF NOT EXISTS idx_agents_available
    ON agents(campaign_id, state) WHERE state = 'AVAILABLE';

-- Index: find stale reservations for recovery
CREATE INDEX IF NOT EXISTS idx_agents_reserved
    ON agents(state, reserved_at) WHERE state = 'RESERVED';

-- Index: agents by campaign for utilization metrics
CREATE INDEX IF NOT EXISTS idx_agents_campaign
    ON agents(campaign_id);

-- ----------------------------
-- Borrowers
-- ----------------------------
CREATE TABLE IF NOT EXISTS borrowers (
    id                  TEXT PRIMARY KEY,
    campaign_id         TEXT NOT NULL REFERENCES campaigns(id),
    phone_number        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'eligible' CHECK (status IN (
                            'eligible', 'allocated', 'completed', 'exhausted',
                            'do_not_call', 'invalid_number'
                        )),
    priority            INTEGER NOT NULL DEFAULT 0,  -- Higher = more urgent
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    last_attempt_at     TEXT,
    next_eligible_at    TEXT,                        -- Null = immediately eligible
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index: find eligible borrowers for a campaign (priority-ordered selection)
CREATE INDEX IF NOT EXISTS idx_borrowers_eligible
    ON borrowers(campaign_id, priority DESC, last_attempt_at ASC)
    WHERE status = 'eligible';

-- Index: prevent duplicate active allocation
CREATE INDEX IF NOT EXISTS idx_borrowers_allocated
    ON borrowers(campaign_id, status) WHERE status = 'allocated';

-- ----------------------------
-- Calls
-- ----------------------------
CREATE TABLE IF NOT EXISTS calls (
    id                      TEXT PRIMARY KEY,
    campaign_id             TEXT NOT NULL REFERENCES campaigns(id),
    agent_id                TEXT REFERENCES agents(id),
    borrower_id             TEXT NOT NULL REFERENCES borrowers(id),
    provider_call_id        TEXT,                    -- ID from telecom provider
    provider_name           TEXT,                    -- Which provider handled this
    state                   TEXT NOT NULL DEFAULT 'QUEUED' CHECK (state IN (
                                'QUEUED', 'RESERVED', 'INITIATED', 'RINGING',
                                'ANSWERED', 'CONNECTED', 'COMPLETED', 'FAILED', 'CANCELLED'
                            )),
    attempt_number          INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    initiated_at            TEXT,
    ringing_at              TEXT,
    answered_at             TEXT,
    connected_at            TEXT,
    completed_at            TEXT,
    failure_reason          TEXT,
    version                 INTEGER NOT NULL DEFAULT 1,
    last_provider_sequence  INTEGER NOT NULL DEFAULT 0,  -- For event ordering
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index: active calls per campaign (for capacity calculation)
CREATE INDEX IF NOT EXISTS idx_calls_active
    ON calls(campaign_id, state)
    WHERE state IN ('QUEUED', 'RESERVED', 'INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED');

-- Index: calls by agent (for agent state lookups)
CREATE INDEX IF NOT EXISTS idx_calls_agent
    ON calls(agent_id, state)
    WHERE state IN ('RESERVED', 'INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED');

-- Index: calls by borrower (prevent duplicate active calls)
CREATE INDEX IF NOT EXISTS idx_calls_borrower_active
    ON calls(borrower_id, state)
    WHERE state IN ('QUEUED', 'RESERVED', 'INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED');

-- Index: lookup by provider call ID (for event processing)
CREATE INDEX IF NOT EXISTS idx_calls_provider
    ON calls(provider_call_id) WHERE provider_call_id IS NOT NULL;

-- Index: recent calls for answer rate calculation
CREATE INDEX IF NOT EXISTS idx_calls_completed
    ON calls(campaign_id, completed_at)
    WHERE state IN ('COMPLETED', 'FAILED');

-- ----------------------------
-- Provider Events (Idempotency Table)
-- ----------------------------
CREATE TABLE IF NOT EXISTS provider_events (
    id              TEXT PRIMARY KEY,
    event_id        TEXT NOT NULL,                   -- Provider's event ID
    provider_name   TEXT NOT NULL,
    provider_call_id TEXT NOT NULL,
    event_type      TEXT NOT NULL CHECK (event_type IN (
                        'RINGING', 'ANSWERED', 'CONNECTED', 'COMPLETED', 'FAILED', 'CANCELLED'
                    )),
    sequence_number INTEGER,                         -- Provider-assigned sequence
    payload_json    TEXT NOT NULL DEFAULT '{}',
    processed       INTEGER NOT NULL DEFAULT 0,      -- 0 = pending, 1 = processed
    duplicate       INTEGER NOT NULL DEFAULT 0,      -- 1 = was a duplicate
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unique constraint: prevents processing the same event twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_events_unique
    ON provider_events(provider_name, event_id);

-- Index: find unprocessed events
CREATE INDEX IF NOT EXISTS idx_provider_events_unprocessed
    ON provider_events(processed) WHERE processed = 0;

-- ----------------------------
-- Provider Health
-- ----------------------------
CREATE TABLE IF NOT EXISTS provider_health (
    provider_name           TEXT PRIMARY KEY,
    total_calls             INTEGER NOT NULL DEFAULT 0,
    successful_calls        INTEGER NOT NULL DEFAULT 0,
    failed_calls            INTEGER NOT NULL DEFAULT 0,
    timed_out_calls         INTEGER NOT NULL DEFAULT 0,
    total_latency_ms        INTEGER NOT NULL DEFAULT 0,  -- Sum for average calc
    health_status           TEXT NOT NULL DEFAULT 'HEALTHY' CHECK (health_status IN (
                                'HEALTHY', 'DEGRADED', 'UNHEALTHY'
                            )),
    last_failure_at         TEXT,
    consecutive_failures    INTEGER NOT NULL DEFAULT 0,
    last_success_at         TEXT,
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------
-- Pacing Decisions (Audit Trail)
-- ----------------------------
CREATE TABLE IF NOT EXISTS pacing_decisions (
    id                      TEXT PRIMARY KEY,
    campaign_id             TEXT NOT NULL REFERENCES campaigns(id),
    mode                    TEXT NOT NULL,            -- 'progressive' or 'predictive'
    requested_calls         INTEGER NOT NULL,
    estimated_answer_rate   REAL,
    available_agents        INTEGER NOT NULL,
    reserved_agents         INTEGER NOT NULL,
    connected_calls         INTEGER NOT NULL,
    ringing_calls           INTEGER NOT NULL,
    dialing_calls           INTEGER NOT NULL,
    safety_buffer           INTEGER NOT NULL,
    provider_health         TEXT NOT NULL,
    reason                  TEXT NOT NULL,
    created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pacing_decisions_campaign
    ON pacing_decisions(campaign_id, created_at);

-- ----------------------------
-- Safety Decisions (Audit Trail)
-- ----------------------------
CREATE TABLE IF NOT EXISTS safety_decisions (
    id                      TEXT PRIMARY KEY,
    campaign_id             TEXT NOT NULL REFERENCES campaigns(id),
    requested_calls         INTEGER NOT NULL,
    approved_calls          INTEGER NOT NULL,
    decision                TEXT NOT NULL CHECK (decision IN (
                                'APPROVE', 'REDUCE', 'REJECT', 'FALLBACK_PROGRESSIVE'
                            )),
    available_agents        INTEGER NOT NULL,
    reserved_agents         INTEGER NOT NULL,
    connected_calls         INTEGER NOT NULL,
    ringing_calls           INTEGER NOT NULL,
    dialing_calls           INTEGER NOT NULL,
    stale_reservations      INTEGER NOT NULL DEFAULT 0,
    provider_health         TEXT NOT NULL,
    recent_failure_rate     REAL NOT NULL DEFAULT 0,
    reason                  TEXT NOT NULL,
    created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_safety_decisions_campaign
    ON safety_decisions(campaign_id, created_at);

-- ----------------------------
-- Schema version tracking
-- ----------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
