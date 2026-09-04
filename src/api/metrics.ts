// ============================================================================
// SmartDialer — Metrics & Observability API Router
// ============================================================================

import { Router, Request, Response } from 'express';
import type { Database } from '../infrastructure/database.js';
import type { SmartDialerConfig } from '../config.js';
import { CampaignRepository } from '../domain/campaign/CampaignRepository.js';
import { AgentRepository } from '../domain/agent/AgentRepository.js';
import { BorrowerRepository } from '../domain/borrower/BorrowerRepository.js';
import { CallRepository } from '../domain/call/CallRepository.js';
import { ProviderHealthRepository } from '../domain/provider/ProviderHealthRepository.js';
import { StaleReservationRecovery } from '../recovery/StaleReservationRecovery.js';
import { AGENT_STATES } from '../domain/agent/AgentState.js';

export function createMetricsRouter(db: Database, config: SmartDialerConfig): Router {
  const router = Router();
  const campaignRepo = new CampaignRepository(db);
  const agentRepo = new AgentRepository(db);
  const borrowerRepo = new BorrowerRepository(db);
  const callRepo = new CallRepository(db);
  const healthRepo = new ProviderHealthRepository(db);
  const recovery = new StaleReservationRecovery(db, config);

  // GET /api/campaigns/:campaignId/metrics
  router.get('/campaigns/:campaignId/metrics', (req: Request, res: Response) => {
    const campaignId = req.params['campaignId'] as string;
    const campaign = campaignRepo.findById(campaignId);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    // Agent metrics
    const agentBreakdown: Record<string, number> = {};
    for (const state of AGENT_STATES) {
      agentBreakdown[state] = agentRepo.countByState(campaignId, state);
    }

    // Call metrics
    const callCounts = callRepo.countActiveByStates(campaignId);
    const allCalls = callRepo.findByCampaign(campaignId);
    const completed = allCalls.filter(c => c.state === 'COMPLETED').length;
    const failed = allCalls.filter(c => c.state === 'FAILED').length;
    const cancelled = allCalls.filter(c => c.state === 'CANCELLED').length;

    // Borrower metrics
    const borrowers = borrowerRepo.findByCampaign(campaignId);
    const eligibleBorrowers = borrowers.filter(b => b.status === 'eligible').length;
    const allocatedBorrowers = borrowers.filter(b => b.status === 'allocated').length;
    const completedBorrowers = borrowers.filter(b => b.status === 'completed').length;
    const exhaustedBorrowers = borrowers.filter(b => b.status === 'exhausted').length;

    // Abandonment estimation
    const answeredCount = allCalls.filter(c => c.answeredAt !== null).length;
    const abandonedCount = allCalls.filter(c => c.state === 'CANCELLED' && c.answeredAt !== null).length;
    const abandonmentRate = answeredCount > 0 ? (abandonedCount / answeredCount) : 0;

    res.json({
      campaignId,
      campaignName: campaign.name,
      status: campaign.status,
      pacingMode: campaign.mode,
      agents: {
        total: agentRepo.findByCampaign(campaignId).length,
        breakdown: agentBreakdown,
      },
      calls: {
        total: allCalls.length,
        activeCounts: callCounts,
        completed,
        failed,
        cancelled,
        abandonmentRate: Number((abandonmentRate * 100).toFixed(2)) + '%',
      },
      borrowers: {
        total: borrowers.length,
        eligible: eligibleBorrowers,
        allocated: allocatedBorrowers,
        completed: completedBorrowers,
        exhausted: exhaustedBorrowers,
      },
    });
  });

  // GET /api/providers/health
  router.get('/providers/health', (_req: Request, res: Response) => {
    const records = healthRepo.findAll();
    res.json(records);
  });

  // POST /api/recovery/stale
  router.post('/recovery/stale', (req: Request, res: Response) => {
    const { campaignId } = req.body;
    const summary = recovery.recoverStaleReservations(campaignId);
    res.json({
      message: 'Stale reservation recovery completed',
      summary,
    });
  });

  return router;
}
