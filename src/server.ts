// ============================================================================
// SmartDialer — Server Entry Point
// ============================================================================

import { createApp } from './app.js';
import { createConfig } from './config.js';
import { createDatabase } from './infrastructure/database.js';
import { runMigrations } from './infrastructure/migrations.js';
import { logger } from './common/logger.js';

async function main(): Promise<void> {
  const config = createConfig();

  // --- Database ---
  logger.info('Initializing database...', { component: 'server' });
  const { db, close: closeDb } = createDatabase(config);
  runMigrations(db);
  logger.info('Database initialized and migrations applied', { component: 'server' });

  const app = createApp({ db, config });

  // --- Start server ---
  const server = app.listen(config.port, config.host, () => {
    logger.info(`SmartDialer listening on ${config.host}:${config.port}`, {
      component: 'server',
    });
    logger.info(`Pacing mode: ${config.pacing.mode}`, { component: 'server' });
  });

  // --- Graceful shutdown ---
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`, { component: 'server' });
    server.close(() => {
      closeDb();
      logger.info('Server shut down', { component: 'server' });
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout', { component: 'server' });
      process.exit(1);
    }, 10000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('Failed to start SmartDialer:', err);
  process.exit(1);
});
