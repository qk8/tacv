import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeVerifierTransition, computeConfidenceScore, ALL_PHASES } from '../../../src/state/transitions.js';
import { createInitialState, type WorkflowState } from '../../../src/state/schemas.js';
import type { WorkflowConfig } from '../../../src/config/index.js';

const defaultConfig: WorkflowConfig = {
  temporalAddress: 'localhost:7233', temporalNamespace: 'default', taskQueue: 'test',
  maxSelfCorrectionCycles: 6, maxReplanAttempts: 2, maxParallelBranches: 3,
  maxParallelCritics: 2, maxNodeTimeoutSec: 600,
  confidenceEscalationThreshold: 0.4, enableMultiModelCritics: false,
  frontendBaseUrl: 'http://localhost:3000', testTimeoutMs: 120_000,
  repoPath: '.', agentModel: 'claude-opus-4-6', agentsMdMaxChars: 4000,
  mem0VectorStore: 'in-memory', mem0Config: {},
  tokenBudget: { criticalDollar: 80, warningDollar: 50, costPerMInput: 5, costPerMOutput: 30 },
  debug: { userJavaPackage: 'com.example', userTsSrcRoot: 'src', jdwpPort: 5005, cdpPort: 9229, debugTimeoutSec: 30, maxDebugSteps: 10, actuatorBaseUrl: 'http://localhost:8080/actuator' },
  stagnation: { totalAbortForce: 3, driftRevisionLimit: 2, semanticSimilarityThreshold: 0.85 },
  shadowMode: { enabled: false, cronSchedule: '0 2 * * *', maxTasksPerRun: 3 },
  coverage: { minimumLineCoverage: 80, maxLineCoverageRegression: 2, maxBranchCoverageRegression: 2 },
  mutation: { enabled: false, minimumScore: 70, maxTestFiles: 10, timeoutSec: 120 },
  visual: { enabled: false, pixelThreshold: 0.02, maxDiffPercent: 1.0, baselineDir: 'visual-baselines', viewports: ['mobile','tablet','desktop'] },
  libraryDocs: { provider: 'disabled', maxTokens: 2000 },
  openApi: { enabled: false },
  performance: { enabled: false, regressionThreshold: 0.20, timeoutSec: 60 },
  langfuse: { enabled: false },
};

const baseTask = { taskId: 't1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return { ...createInitialState(baseTask), ...overrides };
}

describe('computeVerifierTransition', () => {
  it('routes PASS to MEMORY_CONSOLIDATION', () => {
    const s = makeState({ verifierVerdict: { testResult: 'PASS', diagnostic: 'PASS', testFailures: [], blockedByCritic: false, confidenceScore: 1.0 } });
    expect(computeVerifierTransition(s, defaultConfig).nextPhase).toBe('MEMORY_CONSOLIDATION');
  });

  it('routes budget exceeded to HITL_ESCALATION', () => {
    const s = makeState({ cumulativeCostUsd: 90 });
    const t = computeVerifierTransition(s, defaultConfig);
    expect(t.nextPhase).toBe('HITL_ESCALATION');
    if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('budget_exceeded');
  });

  it('routes low confidence to HITL_ESCALATION', () => {
    const s = makeState({ confidenceScore: 0.2 });
    const t = computeVerifierTransition(s, defaultConfig);
    expect(t.nextPhase).toBe('HITL_ESCALATION');
    if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('low_confidence');
  });

  it('routes max cycles to HITL_ESCALATION', () => {
    const s = makeState({ correctionCycle: { attemptCount: 6, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none', lastOutcomeSignature: null } });
    const t = computeVerifierTransition(s, defaultConfig);
    expect(t.nextPhase).toBe('HITL_ESCALATION');
    if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('max_cycles_reached');
  });

  it('routes AMBIGUOUS on early attempt to INTELLIGENT_DEBUGGER', () => {
    const s = makeState({ verifierVerdict: { testResult: 'FAIL', diagnostic: 'AMBIGUOUS', testFailures: [], blockedByCritic: false, confidenceScore: 0.8 } });
    expect(computeVerifierTransition(s, defaultConfig).nextPhase).toBe('INTELLIGENT_DEBUGGER');
  });

  it('routes to SPECULATIVE_BRANCH after 2 failed attempts with candidates', () => {
    const s = makeState({
      correctionCycle: { attemptCount: 2, branchName: 'main', lastErrorHash: null, errorHistory: [], stagnationPattern: 'none', lastOutcomeSignature: null },
      strategyCandidates: [{ strategyId: 's1', description: 'alt', compositeScore: 0.7, estimatedRisk: 'low', affectedFiles: [] }],
      verifierVerdict: { testResult: 'FAIL', diagnostic: 'FIX_IMPL', testFailures: [], blockedByCritic: false, confidenceScore: 0.7 },
    });
    expect(computeVerifierTransition(s, defaultConfig).nextPhase).toBe('SPECULATIVE_BRANCH');
  });

  it('escalation transitions always carry a reason', () => {
    fc.assert(fc.property(
      fc.record({
        cumulativeCostUsd: fc.double({ min: 0, max: 200 }),
        confidenceScore:   fc.double({ min: 0, max: 1 }),
        attemptCount:      fc.nat({ max: 10 }),
        stagnationPattern: fc.constantFrom('none','iteration','semantic','outcome' as const),
      }),
      ({ cumulativeCostUsd, confidenceScore, attemptCount, stagnationPattern }) => {
        const s = makeState({ cumulativeCostUsd, confidenceScore, correctionCycle: { attemptCount, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern, lastOutcomeSignature: null } });
        const t = computeVerifierTransition(s, defaultConfig);
        expect(ALL_PHASES).toContain(t.nextPhase);
        if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBeTruthy();
      }
    ), { numRuns: 200 });
  });

  it('PASS always routes to MEMORY_CONSOLIDATION regardless of cost', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 50 }),
      (cost) => {
        const s = makeState({ cumulativeCostUsd: cost, verifierVerdict: { testResult: 'PASS', diagnostic: 'PASS', testFailures: [], blockedByCritic: false, confidenceScore: 1.0 } });
        expect(computeVerifierTransition(s, defaultConfig).nextPhase).toBe('MEMORY_CONSOLIDATION');
      }
    ), { numRuns: 100 });
  });

  it('routes to REPLAN when all strategies exhausted', () => {
    const s = makeState({
      correctionCycle: { attemptCount: 3, branchName: 'main', lastErrorHash: 'abc', errorHistory: [], stagnationPattern: 'none', lastOutcomeSignature: null },
      strategyCandidates: [
        { strategyId: 's1', description: 'try A', compositeScore: 0.7, estimatedRisk: 'low', affectedFiles: [] },
      ],
      exhaustedBranches: ['s1'],
      verifierVerdict: { testResult: 'FAIL', diagnostic: 'FIX_IMPL', testFailures: [], blockedByCritic: false, confidenceScore: 0.7 },
    });
    const t = computeVerifierTransition(s, defaultConfig);
    expect(t.nextPhase).toBe('REPLAN');
    if (t.nextPhase === 'REPLAN') expect(t.reason).toBe('all_strategies_exhausted');
  });

  it('does NOT route to REPLAN when untried candidates remain', () => {
    const s = makeState({
      correctionCycle: { attemptCount: 3, branchName: 'main', lastErrorHash: 'abc', errorHistory: [], stagnationPattern: 'none', lastOutcomeSignature: null },
      strategyCandidates: [
        { strategyId: 's1', description: 'try A', compositeScore: 0.7, estimatedRisk: 'low', affectedFiles: [] },
        { strategyId: 's2', description: 'try B', compositeScore: 0.6, estimatedRisk: 'medium', affectedFiles: [] },
      ],
      exhaustedBranches: ['s1'],
      verifierVerdict: { testResult: 'FAIL', diagnostic: 'FIX_IMPL', testFailures: [], blockedByCritic: false, confidenceScore: 0.7 },
    });
    const t = computeVerifierTransition(s, defaultConfig);
    expect(t.nextPhase).not.toBe('REPLAN');
  });
});

describe('computeConfidenceScore', () => {
  it('returns 1.0 for fresh state', () => {
    expect(computeConfidenceScore(makeState(), defaultConfig)).toBe(1.0);
  });
  it('decreases with each attempt', () => {
    const s1 = makeState({ correctionCycle: { attemptCount: 1, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none', lastOutcomeSignature: null } });
    const s2 = makeState({ correctionCycle: { attemptCount: 3, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none', lastOutcomeSignature: null } });
    expect(computeConfidenceScore(s1, defaultConfig)).toBeGreaterThan(computeConfidenceScore(s2, defaultConfig));
  });
  it('always stays in [0, 1]', () => {
    fc.assert(fc.property(
      fc.record({ attemptCount: fc.nat({ max: 20 }), confidenceScore: fc.double({ min: 0, max: 1 }), cumulativeCostUsd: fc.double({ min: 0, max: 200 }) }),
      (overrides) => {
        const s = makeState(overrides);
        const score = computeConfidenceScore(s, defaultConfig);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    ), { numRuns: 300 });
  });
});
