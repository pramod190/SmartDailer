#!/usr/bin/env node
// ============================================================================
// CLI script to run all simulation scenarios
// ============================================================================

import { runAllScenarios, formatComparisonReport } from './scenarios.js';

console.log('Running SmartDialer Simulation Benchmarks across Scenarios A, B, C, D...\n');
const results = runAllScenarios();
const report = formatComparisonReport(results);
console.log(report);
