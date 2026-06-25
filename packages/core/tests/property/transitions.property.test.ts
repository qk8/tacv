import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeVerifierTransition, computeConfidenceScore, ALL_PHASES } from '../../src/state/transitions.js';
import { createInitialState } from '../../src/state/schemas.js';
import { loadConfig } from '../../src/config/index.js';

const config = loadConfig();
const task = { taskId: 'prop-test', description: 'property test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };
const baseState = createInitialState(task);

describe('computeVerifierTransition — property tests', () => {
  it('always returns a valid WorkflowPhase', () => {
    fc.assert(fc.property(
      fc.record({
        cumulativeCostUsd: fc.double({ min: 0, max: 200, noNaN: true }),
        confidenceScore:   fc.double({ min: 0, max: 1, noNaN: true }),
        attemptCount:      fc.nat({ max: 10 }),
        stagnationPattern: fc.constantFrom('none', 'iteration', 'semantic', 'outcome' as const),
        testResult:        fc.constantFrom('PASS', 'FAIL', 'AMBIGUOUS' as const),
        diagnostic:        fc.constantFrom('PASS', 'FIX_IMPL', 'FIX_TEST', 'AMBIGUOUS' as const),
      }),
      ({ cumulativeCostUsd, confidenceScore, attemptCount, stagnationPattern, testResult, diagnostic }) => {
        const state = {
          ...baseState,
          cumulativeCostUsd,
          confidenceScore,
          correctionCycle: { ...baseState.correctionCycle, attemptCount, stagnationPattern },
          verifierVerdict: { testResult, diagnostic, testFailures: [], blockedByCritic: false, confidenceScore },
        };
        const t = computeVerifierTransition(state as never, config);
        expect(ALL_PHASES).toContain(t.nextPhase);
      }
    ), { numRuns: 500 });
  });

  it('HITL escalation always has a reason', () => {
    fc.assert(fc.property(
      fc.record({
        cumulativeCostUsd: fc.double({ min: 0, max: 200, noNaN: true }),
        confidenceScore:   fc.double({ min: 0, max: 1, noNaN: true }),
        attemptCount:      fc.nat({ max: 15 }),
      }),
      ({ cumulativeCostUsd, confidenceScore, attemptCount }) => {
        const state = { ...baseState, cumulativeCostUsd, confidenceScore, correctionCycle: { ...baseState.correctionCycle, attemptCount } };
        const t = computeVerifierTransition(state as never, config);
        if (t.nextPhase === 'HITL_ESCALATION') {
          expect((t as { reason: string }).reason).toBeTruthy();
        }
      }
    ), { numRuns: 300 });
  });

  it('PASS verdict always routes to MEMORY_CONSOLIDATION regardless of other state', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 50, noNaN: true }),
      (cost) => {
        const state = {
          ...baseState,
          cumulativeCostUsd: cost,
          confidenceScore: 1.0,
          verifierVerdict: { testResult: 'PASS' as const, diagnostic: 'PASS' as const, testFailures: [], blockedByCritic: false, confidenceScore: 1.0 },
        };
        expect(computeVerifierTransition(state as never, config).nextPhase).toBe('MEMORY_CONSOLIDATION');
      }
    ), { numRuns: 200 });
  });

  it('confidence score always in [0, 1]', () => {
    fc.assert(fc.property(
      fc.record({
        attemptCount:      fc.nat({ max: 20 }),
        cumulativeCostUsd: fc.double({ min: 0, max: 200, noNaN: true }),
        stagnationPattern: fc.constantFrom('none', 'iteration', 'semantic', 'outcome' as const),
      }),
      ({ attemptCount, cumulativeCostUsd, stagnationPattern }) => {
        const state = { ...baseState, cumulativeCostUsd, correctionCycle: { ...baseState.correctionCycle, attemptCount, stagnationPattern } };
        const score = computeConfidenceScore(state as never, config);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    ), { numRuns: 400 });
  });

  it('budget_exceeded escalation fires when cost >= criticalDollar', () => {
    fc.assert(fc.property(
      fc.double({ min: 80, max: 1000, noNaN: true }),
      (cost) => {
        const state = { ...baseState, cumulativeCostUsd: cost, verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [], blockedByCritic: false, confidenceScore: 0.8 } };
        const t = computeVerifierTransition(state as never, config);
        expect(t.nextPhase).toBe('HITL_ESCALATION');
        if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('budget_exceeded');
      }
    ), { numRuns: 100 });
  });
});
