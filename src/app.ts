// ============================================================================
// SmartDialer — Express Application Setup
// ============================================================================

import express from 'express';
import type { Database } from './infrastructure/database.js';
import { createDatabase } from './infrastructure/database.js';
import { runMigrations } from './infrastructure/migrations.js';
import { createConfig, type SmartDialerConfig } from './config.js';
import type { TelecomProvider } from './provider/TelecomProvider.js';
import { ReliableMockProvider } from './provider/ReliableMockProvider.js';
import { createCampaignsRouter } from './api/campaigns.js';
import { createAgentsRouter } from './api/agents.js';
import { createBorrowersRouter } from './api/borrowers.js';
import { createDialerRouter } from './api/dialer.js';
import { createSimulationRouter } from './api/simulation.js';
import { createMetricsRouter } from './api/metrics.js';

export interface AppDependencies {
  db?: Database;
  config?: SmartDialerConfig;
  provider?: TelecomProvider;
}

export function createApp(deps: AppDependencies = {}): express.Application {
  const app = express();

  const config = deps.config ?? createConfig();
  const db = deps.db ?? (() => {
    const { db: newDb } = createDatabase(config);
    runMigrations(newDb);
    return newDb;
  })();
  const provider = deps.provider ?? new ReliableMockProvider();

  // --- Middleware ---
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // --- Health check ---
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'smart-dialer',
      timestamp: new Date().toISOString(),
      pacingMode: config.pacing.mode,
    });
  });

  // --- API Routes ---
  app.use('/api/campaigns', createCampaignsRouter(db));
  app.use('/api', createAgentsRouter(db));
  app.use('/api', createBorrowersRouter(db));
  app.use('/api', createDialerRouter(db, config, provider));
  app.use('/api/simulation', createSimulationRouter(db));
  app.use('/api', createMetricsRouter(db, config));

  // --- 404 Handler ---
  app.use((_req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // --- Error handler ---
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[app] Unhandled error:', err.message);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env['NODE_ENV'] === 'production' ? undefined : err.message,
    });
  });

  return app;
}
