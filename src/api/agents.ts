// ============================================================================
// SmartDialer — Agents API Router
// ============================================================================

import { Router, Request, Response } from 'express';
import type { Database } from '../infrastructure/database.js';
import { AgentRepository } from '../domain/agent/AgentRepository.js';
import { AgentStateMachine, type AgentState, AGENT_STATES } from '../domain/agent/AgentState.js';

export function createAgentsRouter(db: Database): Router {
  const router = Router();
  const repo = new AgentRepository(db);

  // POST /api/campaigns/:campaignId/agents
  router.post('/campaigns/:campaignId/agents', (req: Request, res: Response) => {
    const campaignId = req.params['campaignId'] as string;
    const { state, count } = req.body;
    const initialState: AgentState = state ?? 'AVAILABLE';

    if (count && typeof count === 'number' && count > 1) {
      const created = [];
      for (let i = 0; i < count; i++) {
        created.push(repo.create(campaignId, initialState));
      }
      res.status(201).json({ createdCount: created.length, agents: created });
      return;
    }

    const agent = repo.create(campaignId, initialState);
    res.status(201).json(agent);
  });

  // GET /api/campaigns/:campaignId/agents
  router.get('/campaigns/:campaignId/agents', (req: Request, res: Response) => {
    const campaignId = req.params['campaignId'] as string;
    const agents = repo.findByCampaign(campaignId);
    res.json(agents);
  });

  // GET /api/agents/:id
  router.get('/agents/:id', (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const agent = repo.findById(id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(agent);
  });

  // PATCH /api/agents/:id/state
  router.patch('/agents/:id/state', (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const { targetState } = req.body;
    if (!targetState || !AGENT_STATES.includes(targetState)) {
      res.status(400).json({ error: `Invalid state. Allowed: ${AGENT_STATES.join(', ')}` });
      return;
    }

    const agent = repo.findById(id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    try {
      AgentStateMachine.validateTransition(agent.state, targetState);
    } catch (err: any) {
      res.status(400).json({ error: 'Invalid state transition', details: err.message });
      return;
    }

    const updated = repo.transitionState(agent.id, targetState, agent.version);
    if (!updated) {
      res.status(409).json({ error: 'Conflict: Agent state was modified concurrently' });
      return;
    }

    const fresh = repo.findById(agent.id);
    res.json(fresh);
  });

  // POST /api/agents/:id/heartbeat
  router.post('/agents/:id/heartbeat', (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const updated = repo.updateHeartbeat(id);
    if (!updated) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json({ message: 'Heartbeat recorded', agentId: id });
  });

  return router;
}
