// ============================================================================
// SmartDialer — Campaigns API Router
// ============================================================================

import { Router, Request, Response } from 'express';
import type { Database } from '../infrastructure/database.js';
import { CampaignRepository } from '../domain/campaign/CampaignRepository.js';
import { CAMPAIGN_STATUSES, type CampaignMode, type CampaignStatus } from '../domain/campaign/Campaign.js';

export function createCampaignsRouter(db: Database): Router {
  const router = Router();
  const repo = new CampaignRepository(db);

  // POST /api/campaigns
  router.post('/', (req: Request, res: Response) => {
    const { name, mode, targetAbandonmentRate, maxConcurrency } = req.body;
    if (!name || !mode) {
      res.status(400).json({ error: 'Missing required fields: name, mode' });
      return;
    }

    if (!['progressive', 'predictive'].includes(mode)) {
      res.status(400).json({ error: 'Invalid mode. Must be progressive or predictive' });
      return;
    }

    const campaign = repo.create(name, mode as CampaignMode, {
      targetAbandonmentRate,
      maxConcurrentCalls: maxConcurrency,
    });
    res.status(201).json(campaign);
  });

  // GET /api/campaigns
  router.get('/', (_req: Request, res: Response) => {
    const campaigns = repo.findAll();
    res.json(campaigns);
  });

  // GET /api/campaigns/:id
  router.get('/:id', (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const campaign = repo.findById(id);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    res.json(campaign);
  });

  // PATCH /api/campaigns/:id/status
  router.patch('/:id/status', (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const { status } = req.body;
    if (!status || !CAMPAIGN_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${CAMPAIGN_STATUSES.join(', ')}` });
      return;
    }

    const updated = repo.updateStatus(id, status as CampaignStatus);
    if (!updated) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    res.json({ message: 'Campaign status updated', campaignId: id, status });
  });

  return router;
}
