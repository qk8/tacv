import { describe, it, expect } from 'vitest';
import { createInitialState, withPhase, withCost } from '../../src/state/schemas.js';
import { computeVerifierTransition } from '../../src/state/transitions.js';
import { loadConfig } from '../../src/config/index.js';

/**
 * Workflow orchestration logic tests.
 *
 * Full Temporal integration tests require a running Temporal server and are
 * kept in the e2e/ directory. These tests verify the routing and state logic
 * that the CodingWorkflow exercises, without requiring Temporal.
 */

const config = loadConfig();
const task = { taskId: 'wf-test-1', description: 'Add user authentication', mode: 'GREENFIELD' as const, moduleType: 'java-backend', languageIds: ['java'] };

describe('CodingWorkflow orchestration logic', () => {
  it('initial state starts at BOOTSTRAP phase', () => {
    const state = createInitialState(task);
    expect(state.currentPhase).toBe('BOOTSTRAP');
    expect(state.correctionCycle.attemptCount).toBe(0);
    expect(state.cumulativeCostUsd).toBe(0);
  });

  it('routes to MEMORY_CONSOLIDATION on first PASS', () => {
    const state = {
      ...createInitialState(task),
      verifierVerdict: { testResult: 'PASS' as const, diagnostic: 'PASS' as const, testFailures: [], blockedByCritic: false, confidenceScore: 1.0 },
    };
    expect(computeVerifierTransition(state as never, config).nextPhase).toBe('MEMORY_CONSOLIDATION');
  });

  it('routes to INTELLIGENT_DEBUGGER on AMBIGUOUS verdict (attempt 0)', () => {
    const state = {
      ...createInitialState(task),
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'AMBIGUOUS' as const, testFailures: [{ message: 'Unknown failure' }], blockedByCritic: false, confidenceScore: 0.8 },
    };
    expect(computeVerifierTransition(state as never, config).nextPhase).toBe('INTELLIGENT_DEBUGGER');
  });

  it('routes to SPECULATIVE_BRANCH after 2 failed attempts with strategy candidates', () => {
    const state = {
      ...createInitialState(task),
      correctionCycle: { ...createInitialState(task).correctionCycle, attemptCount: 2, branchName: 'main' },
      strategyCandidates: [{ strategyId: 's1', description: 'alt approach', compositeScore: 0.7, estimatedRisk: 'low' as const, affectedFiles: [] }],
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ message: 'Test failed' }], blockedByCritic: false, confidenceScore: 0.6 },
    };
    expect(computeVerifierTransition(state as never, config).nextPhase).toBe('SPECULATIVE_BRANCH');
  });

  it('escalates to HITL after max correction cycles', () => {
    const state = {
      ...createInitialState(task),
      correctionCycle: { ...createInitialState(task).correctionCycle, attemptCount: 6 },
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ message: 'Test failed' }], blockedByCritic: false, confidenceScore: 0.5 },
    };
    const t = computeVerifierTransition(state as never, config);
    expect(t.nextPhase).toBe('HITL_ESCALATION');
    if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('max_cycles_reached');
  });

  it('escalates to HITL on budget exceeded', () => {
    const state = withCost({ ...createInitialState(task), verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [], blockedByCritic: false, confidenceScore: 0.8 } } as never, 85);
    const t = computeVerifierTransition(state as never, config);
    expect(t.nextPhase).toBe('HITL_ESCALATION');
    if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('budget_exceeded');
  });

  it('escalates on low confidence', () => {
    const state = { ...createInitialState(task), confidenceScore: 0.1, verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [], blockedByCritic: false, confidenceScore: 0.1 } };
    const t = computeVerifierTransition(state as never, config);
    expect(t.nextPhase).toBe('HITL_ESCALATION');
    if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('low_confidence');
  });

  it('stagnation triggers HITL escalation', () => {
    const state = {
      ...createInitialState(task),
      correctionCycle: { ...createInitialState(task).correctionCycle, attemptCount: 3, stagnationPattern: 'iteration' as const },
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [], blockedByCritic: false, confidenceScore: 0.6 },
    };
    const t = computeVerifierTransition(state as never, config);
    expect(t.nextPhase).toBe('HITL_ESCALATION');
    if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('stagnation');
  });

  it('phase transitions are immutable', () => {
    const s1 = createInitialState(task);
    const s2 = withPhase(s1, 'ACTOR');
    expect(s1.currentPhase).toBe('BOOTSTRAP');
    expect(s2.currentPhase).toBe('ACTOR');
    expect(s1).not.toBe(s2);
  });
});
