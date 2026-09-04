// ============================================================================
// SmartDialer — Borrowers API Router
// ============================================================================

import { Router, Request, Response } from 'express';
import type { Database } from '../infrastructure/database.js';
import { BorrowerRepository } from '../domain/borrower/BorrowerRepository.js';

export function createBorrowersRouter(db: Database): Router {
  const router = Router();
  const repo = new BorrowerRepository(db);

  // POST /api/campaigns/:campaignId/borrowers
  // Supports single borrower or batch { borrowers: [{ phoneNumber, priority }] }
  router.post('/campaigns/:campaignId/borrowers', (req: Request, res: Response) => {
    const campaignId = req.params['campaignId'] as string;
    const { phoneNumber, priority, borrowers } = req.body;

    if (Array.isArray(borrowers)) {
      const created = [];
      for (const b of borrowers) {
        if (b.phoneNumber) {
          created.push(repo.create(campaignId, b.phoneNumber, b.priority ?? 0));
        }
      }
      res.status(201).json({ createdCount: created.length, borrowers: created });
      return;
    }

    if (!phoneNumber) {
      res.status(400).json({ error: 'Missing phoneNumber' });
      return;
    }

    const borrower = repo.create(campaignId, phoneNumber, priority ?? 0);
    res.status(201).json(borrower);
  });

  // GET /api/campaigns/:campaignId/borrowers
  router.get('/campaigns/:campaignId/borrowers', (req: Request, res: Response) => {
    const campaignId = req.params['campaignId'] as string;
    const status = req.query['status'] as string | undefined;

    const borrowers = status
      ? repo.findByCampaign(campaignId).filter(b => b.status === status)
      : repo.findByCampaign(campaignId);

    res.json(borrowers);
  });

  // GET /api/borrowers/:id
  router.get('/borrowers/:id', (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const borrower = repo.findById(id);
    if (!borrower) {
      res.status(404).json({ error: 'Borrower not found' });
      return;
    }
    res.json(borrower);
  });

  return router;
}
