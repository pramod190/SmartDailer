// ============================================================================
// SmartDialer — Simulation Scenarios & Benchmarks
// ============================================================================
// Defines standard benchmark scenarios to evaluate and compare dialing strategies:
//   - Scenario A: Low answer rate (20%), 120s talk time
//   - Scenario B: Medium answer rate (50%), 90s talk time
//   - Scenario C: High answer rate (70%), 180s talk time (high overdial risk)
//   - Scenario D: Dynamic/Stress with unreliable provider and high agent count
// ============================================================================

import { createInMemoryDatabase } from '../infrastructure/database.js';
import { runSimulation, type SimulationParams, type SimulationResult } from './SimulationRunner.js';

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  params: Omit<SimulationParams, 'mode'>;
}

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'SCENARIO_A',
    name: 'Scenario A: Low Answer Rate',
    description: '20% answer rate, 120s talk time. Demonstrates predictive pacing keeping agents busy.',
    params: {
      numAgents: 20,
      numBorrowers: 100,
      numTicks: 15,
      providerType: 'reliable',
      answerRate: 0.20,
      failureRate: 0.02,
      seed: 101,
    },
  },
  {
    id: 'SCENARIO_B',
    name: 'Scenario B: Medium Answer Rate',
    description: '50% answer rate, 90s talk time. Typical production collections environment.',
    params: {
      numAgents: 25,
      numBorrowers: 150,
      numTicks: 15,
      providerType: 'reliable',
      answerRate: 0.50,
      failureRate: 0.02,
      seed: 202,
    },
  },
  {
    id: 'SCENARIO_C',
    name: 'Scenario C: High Answer Rate (Safety Stress)',
    description: '70% answer rate, 180s talk time. Safety Controller must clamp overdialing to avoid abandoned calls.',
    params: {
      numAgents: 20,
      numBorrowers: 100,
      numTicks: 15,
      providerType: 'reliable',
      answerRate: 0.70,
      failureRate: 0.01,
      seed: 303,
    },
  },
  {
    id: 'SCENARIO_D',
    name: 'Scenario D: Unreliable Provider & Network Stress',
    description: '50 agents, 250 borrowers with network timeouts, dropped calls, and out-of-order events.',
    params: {
      numAgents: 50,
      numBorrowers: 250,
      numTicks: 20,
      providerType: 'unreliable',
      answerRate: 0.45,
      failureRate: 0.05,
      seed: 404,
    },
  },
];

export interface ScenarioComparison {
  scenario: ScenarioDefinition;
  progressive: SimulationResult;
  predictive: SimulationResult;
}

export function runScenario(scenario: ScenarioDefinition): ScenarioComparison {
  const dbProg = createInMemoryDatabase();
  const progressive = runSimulation(dbProg, {
    ...scenario.params,
    mode: 'progressive',
  });

  const dbPred = createInMemoryDatabase();
  const predictive = runSimulation(dbPred, {
    ...scenario.params,
    mode: 'predictive',
  });

  return {
    scenario,
    progressive,
    predictive,
  };
}

export function runAllScenarios(): ScenarioComparison[] {
  return SCENARIOS.map(s => runScenario(s));
}

export function formatComparisonReport(comparisons: ScenarioComparison[]): string {
  const lines: string[] = [];
  lines.push('========================================================================================');
  lines.push('                             SMARTDIALER SIMULATION BENCHMARK REPORT                    ');
  lines.push('========================================================================================');
  lines.push('');

  for (const c of comparisons) {
    lines.push(`--- ${c.scenario.name} ---`);
    lines.push(c.scenario.description);
    lines.push(`Config: ${c.scenario.params.numAgents} Agents | ${c.scenario.params.numBorrowers} Borrowers | ${c.scenario.params.numTicks} Ticks | Provider: ${c.scenario.params.providerType}`);
    lines.push('');
    lines.push('| Metric                          | Progressive Pacing    | Predictive Pacing     |');
    lines.push('|---------------------------------|-----------------------|-----------------------|');
    lines.push(`| Total Calls Placed              | ${c.progressive.totals.totalCalls.toString().padEnd(21)} | ${c.predictive.totals.totalCalls.toString().padEnd(21)} |`);
    lines.push(`| Completed Calls (Connected)     | ${c.progressive.totals.completedCalls.toString().padEnd(21)} | ${c.predictive.totals.completedCalls.toString().padEnd(21)} |`);
    lines.push(`| Failed / Timeout Calls          | ${c.progressive.totals.failedCalls.toString().padEnd(21)} | ${c.predictive.totals.failedCalls.toString().padEnd(21)} |`);
    lines.push(`| Borrowers Reached               | ${c.progressive.totals.completedBorrowers.toString().padEnd(21)} | ${c.predictive.totals.completedBorrowers.toString().padEnd(21)} |`);
    lines.push(`| Events Processed                | ${c.progressive.totals.totalEventsProcessed.toString().padEnd(21)} | ${c.predictive.totals.totalEventsProcessed.toString().padEnd(21)} |`);
    lines.push(`| Deduplicated / Stale Events     | ${(c.progressive.totals.totalDuplicatesRejected + c.progressive.totals.totalStaleRejected).toString().padEnd(21)} | ${(c.predictive.totals.totalDuplicatesRejected + c.predictive.totals.totalStaleRejected).toString().padEnd(21)} |`);
    lines.push(`| Invariant: No Double Res.       | ${c.progressive.invariants.noDoubleReservation ? 'PASSED ✅             ' : 'FAILED ❌             '} | ${c.predictive.invariants.noDoubleReservation ? 'PASSED ✅             ' : 'FAILED ❌             '} |`);
    lines.push(`| Invariant: All Calls Terminal   | ${c.progressive.invariants.allCallsTerminal ? 'PASSED ✅             ' : 'FAILED ❌             '} | ${c.predictive.invariants.allCallsTerminal ? 'PASSED ✅             ' : 'FAILED ❌             '} |`);
    lines.push(`| Invariant: No Orphaned Agents   | ${c.progressive.invariants.noOrphanedAgents ? 'PASSED ✅             ' : 'FAILED ❌             '} | ${c.predictive.invariants.noOrphanedAgents ? 'PASSED ✅             ' : 'FAILED ❌             '} |`);
    lines.push('');
  }

  lines.push('All benchmark scenarios completed.');
  return lines.join('\n');
}
