// ============================================================================
// SmartDialer — Simulation API Router
// ============================================================================

import { Router, Request, Response } from 'express';
import type { Database } from '../infrastructure/database.js';
import { runSimulation, type SimulationParams } from '../simulation/SimulationRunner.js';
import { SCENARIOS, runScenario } from '../simulation/scenarios.js';

export function createSimulationRouter(db: Database): Router {
  const router = Router();

  // GET /api/simulation/scenarios
  router.get('/scenarios', (_req: Request, res: Response) => {
    res.json(SCENARIOS);
  });

  // POST /api/simulation/scenarios/:id/run
  router.post('/scenarios/:id/run', (req: Request, res: Response) => {
    const scenario = SCENARIOS.find(s => s.id === req.params.id);
    if (!scenario) {
      res.status(404).json({ error: `Scenario ${req.params.id} not found` });
      return;
    }

    const comparison = runScenario(scenario);
    res.json(comparison);
  });

  // POST /api/simulation/run
  router.post('/run', (req: Request, res: Response) => {
    const params = req.body as SimulationParams;
    if (!params || !params.mode || !params.numAgents || !params.numBorrowers || !params.numTicks) {
      res.status(400).json({ error: 'Missing required simulation parameters: mode, numAgents, numBorrowers, numTicks' });
      return;
    }

    const result = runSimulation(db, {
      ...params,
      providerType: params.providerType ?? 'reliable',
    });
    res.json(result);
  });

  return router;
}
