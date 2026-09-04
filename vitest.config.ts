import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Ensure node: protocol modules are treated as external
    conditions: ['node'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,       // 30s for concurrency/load tests
    hookTimeout: 15000,
    pool: 'forks',            // Use forks for true process isolation in concurrency tests
    reporters: ['verbose'],
    deps: {
      // Don't let Vitest try to transform node:sqlite
      interopDefault: true,
    },
    server: {
      deps: {
        external: [/^node:/],
        inline: [],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/simulation/run.ts', 'src/loadtest/run.ts'],
    },
  },
});
