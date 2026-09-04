// ============================================================================
// SmartDialer — REST API Integration Tests
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../../src/app.js';
import { createTestDatabase } from '../helpers/testDb.js';
import { createConfig } from '../../src/config.js';
import { ReliableMockProvider } from '../../src/provider/ReliableMockProvider.js';

describe('SmartDialer REST API End-to-End', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const db = createTestDatabase();
    const config = createConfig();
    const provider = new ReliableMockProvider({ failureRate: 0 });
    const app = createApp({ db, config, provider });

    await new Promise<void>(resolve => {
      server = app.listen(0, () => {
        const address = server.address() as any;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('GET /health returns ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('smart-dialer');
  });

  it('Campaign CRUD and Lifecycle', async () => {
    // 1. Create campaign
    const createRes = await fetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Spring Collection 2026',
        mode: 'progressive',
      }),
    });
    expect(createRes.status).toBe(201);
    const campaign = await createRes.json();
    expect(campaign.id).toBeDefined();
    expect(campaign.name).toBe('Spring Collection 2026');
    expect(campaign.status).toBe('created');

    // 2. Get campaign
    const getRes = await fetch(`${baseUrl}/api/campaigns/${campaign.id}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.id).toBe(campaign.id);

    // 3. Update status to active
    const patchRes = await fetch(`${baseUrl}/api/campaigns/${campaign.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    expect(patchRes.status).toBe(200);
  });

  it('Agent and Borrower Management', async () => {
    // Create campaign
    const campRes = await fetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Agent Test Campaign', mode: 'progressive' }),
    });
    const campaign = await campRes.json();

    // Create batch agents
    const agentsRes = await fetch(`${baseUrl}/api/campaigns/${campaign.id}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 5, state: 'AVAILABLE' }),
    });
    expect(agentsRes.status).toBe(201);
    const agentsData = await agentsRes.json();
    expect(agentsData.createdCount).toBe(5);

    // Get agents
    const listAgentsRes = await fetch(`${baseUrl}/api/campaigns/${campaign.id}/agents`);
    const agents = await listAgentsRes.json();
    expect(agents.length).toBe(5);

    // Agent state transition
    const agentId = agents[0].id;
    const pauseRes = await fetch(`${baseUrl}/api/agents/${agentId}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetState: 'PAUSED' }),
    });
    expect(pauseRes.status).toBe(200);
    const pausedAgent = await pauseRes.json();
    expect(pausedAgent.state).toBe('PAUSED');

    // Invalid agent state transition (PAUSED -> CONNECTED is rejected by FSM)
    const invalidRes = await fetch(`${baseUrl}/api/agents/${agentId}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetState: 'CONNECTED' }),
    });
    expect(invalidRes.status).toBe(400);

    // Import batch borrowers
    const borrowersRes = await fetch(`${baseUrl}/api/campaigns/${campaign.id}/borrowers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        borrowers: [
          { phoneNumber: '555-1001', priority: 5 },
          { phoneNumber: '555-1002', priority: 9 },
        ],
      }),
    });
    expect(borrowersRes.status).toBe(201);
    const borrowersData = await borrowersRes.json();
    expect(borrowersData.createdCount).toBe(2);
  });

  it('Dialer Tick, Event Webhook, and Metrics', async () => {
    // Create active campaign with 2 available agents and 2 borrowers
    const campRes = await fetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dialer Exec Campaign', mode: 'progressive' }),
    });
    const campaign = await campRes.json();
    await fetch(`${baseUrl}/api/campaigns/${campaign.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });

    await fetch(`${baseUrl}/api/campaigns/${campaign.id}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 2 }),
    });

    await fetch(`${baseUrl}/api/campaigns/${campaign.id}/borrowers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        borrowers: [
          { phoneNumber: '555-3001', priority: 1 },
          { phoneNumber: '555-3002', priority: 2 },
        ],
      }),
    });

    // Trigger tick
    const tickRes = await fetch(`${baseUrl}/api/campaigns/${campaign.id}/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'progressive' }),
    });
    expect(tickRes.status).toBe(200);
    const tickData = await tickRes.json();
    expect(tickData.tickResult).toBeDefined();

    // Check campaign metrics
    const metricsRes = await fetch(`${baseUrl}/api/campaigns/${campaign.id}/metrics`);
    expect(metricsRes.status).toBe(200);
    const metrics = await metricsRes.json();
    expect(metrics.campaignId).toBe(campaign.id);
    expect(metrics.agents.total).toBe(2);
    expect(metrics.borrowers.total).toBe(2);
  });

  it('Simulation API execution', async () => {
    const simRes = await fetch(`${baseUrl}/api/simulation/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'progressive',
        numAgents: 5,
        numBorrowers: 20,
        numTicks: 3,
        providerType: 'reliable',
      }),
    });
    expect(simRes.status).toBe(200);
    const simResult = await simRes.json();
    expect(simResult.invariants.noDoubleReservation).toBe(true);
    expect(simResult.invariants.allCallsTerminal).toBe(true);
    expect(simResult.totals.totalCalls).toBeGreaterThan(0);
  });
});
