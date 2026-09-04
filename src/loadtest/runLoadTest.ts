#!/usr/bin/env node
// ============================================================================
// CLI script to run load tests across 100, 1000, 10000 agents
// ============================================================================

import { runLoadTestTier, formatLoadTestReport } from './LoadTest.js';

console.log('Starting SmartDialer Scale & Load Benchmark (100, 1,000, 10,000 agents)...\n');

const tiers = [100, 1000, 10000];
const metrics = tiers.map(tier => {
  console.log(`Running tier: ${tier} agents...`);
  return runLoadTestTier(tier, 200);
});

console.log('\n' + formatLoadTestReport(metrics));
