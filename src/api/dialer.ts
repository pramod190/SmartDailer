// ============================================================================
// SmartDialer — Dialer & Events API Router
// ============================================================================

import { Router, Request, Response } from 'express';
import type { Database } from '../infrastructure/database.js';
import type { SmartDialerConfig } from '../config.js';
import type { TelecomProvider, ProviderEvent } from '../provider/TelecomProvider.js';
import { CampaignRepository } from '../domain/campaign/CampaignRepository.js';
import { CallRepository } from '../domain/call/CallRepository.js';
import { ProgressiveDialer } from '../pacing/ProgressiveDialer.js';
import { PredictiveDialer } from '../pacing/PredictiveDialer.js';
import { ProviderEventHandler } from '../events/ProviderEventHandler.js';

export function createDialerRouter(
  db: Database,
  config: SmartDialerConfig,
  provider: TelecomProvider,
): Router {
  const router = Router();
  const campaignRepo = new CampaignRepository(db);
  const callRepo = new CallRepository(db);
  const progressiveDialer = new ProgressiveDialer(db, config);
  const predictiveDialer = new PredictiveDialer(db, config);
  const eventHandler = new ProviderEventHandler(db, config);

  // POST /api/campaigns/:campaignId/tick
  // Manually or periodically triggers a dialer tick
  router.post('/campaigns/:campaignId/tick', (req: Request, res: Response) => {
    const campaignId = req.params['campaignId'] as string;
    const campaign = campaignRepo.findById(campaignId);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const mode = req.body.mode ?? campaign.mode;

    let result: any;
    if (mode === 'progressive') {
      result = progressiveDialer.tick(campaignId, provider);
    } else {
      result = predictiveDialer.tick(campaignId, provider);
    }

    // Auto-drain events if provider is a mock provider with eventQueue
    let drainedEvents = 0;
    if (typeof (provider as any).drainEvents === 'function') {
      const events: ProviderEvent[] = (provider as any).drainEvents();
      drainedEvents = events.length;
      for (const ev of events) {
        eventHandler.processEvent(ev);
      }
    }

    res.json({
      campaignId,
      mode,
      tickResult: result,
      drainedEventsProcessed: drainedEvents,
    });
  });

  // POST /api/events
  // Webhook for provider events
  router.post('/events', (req: Request, res: Response) => {
    const event = req.body as ProviderEvent;
    if (!event || !event.eventId || !event.providerCallId || !event.eventType) {
      res.status(400).json({ error: 'Missing required event fields: eventId, providerCallId, eventType' });
      return;
    }

    const result = eventHandler.processEvent(event);
    res.json(result);
  });

  // GET /api/campaigns/:campaignId/calls
  router.get('/campaigns/:campaignId/calls', (req: Request, res: Response) => {
    const campaignId = req.params['campaignId'] as string;
    const calls = callRepo.findByCampaign(campaignId);
    res.json(calls);
  });

  return router;
}
