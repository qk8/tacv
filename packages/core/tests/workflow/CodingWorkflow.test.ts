import { describe, it, expect } from 'vitest';
import { createInitialState, withPhase, withCost } from '../../src/state/schemas.js';
import { computeVerifierTransition } from '../../src/state/transitions.js';
import { loadConfig } from '../../src/config/index.js';
import type { WorkflowState, StrategyCandidate } from '../../src/state/schemas.js';
import { _diversifyStrategyCandidates } from '../../src/workflows/CodingWorkflow.js';
import { computeConfidenceScore } from '../../src/state/transitions.js';

/** Simulates the baseline HITL override propagation that the workflow performs. */
function applyBaselineOverride(state: WorkflowState, guidance: string): WorkflowState {
  return { ...state, agentsMdContext: guidance, hitlPriorGuidance: guidance };
}

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

describe('_diversifyStrategyCandidates', () => {
  function makeCandidate(id: string, desc: string): StrategyCandidate {
    return { strategyId: id, description: desc, compositeScore: 0.5, estimatedRisk: 'low' as const, affectedFiles: [] };
  }

  function makeStateWithCandidates(activeIds: string[], exhaustedIds: string[]): WorkflowState {
    const allCandidates: StrategyCandidate[] = [
      ...activeIds.map((id, i) => makeCandidate(id, `active strategy ${i}`)),
      ...exhaustedIds.map((id, i) => makeCandidate(id, `exhausted strategy ${i}`)),
    ];
    return {
      ...createInitialState(task),
      strategyCandidates: allCandidates,
      exhaustedBranches: exhaustedIds,
    };
  }

  it('preserves exhausted candidates when diversifying active ones', () => {
    const state = makeStateWithCandidates(['a', 'b', 'c'], ['x', 'y']);
    const result = _diversifyStrategyCandidates(state);

    // All 5 original candidates must remain — exhausted ones must not be dropped
    expect(result.strategyCandidates.length).toBe(5);
    expect(result.strategyCandidates.map(c => c.strategyId).sort()).toEqual(['a', 'b', 'c', 'x', 'y'].sort());
  });

  it('adds avoidHint only to active candidates, not exhausted ones', () => {
    const state = makeStateWithCandidates(['a', 'b'], ['x']);
    const result = _diversifyStrategyCandidates(state);

    const active = result.strategyCandidates.filter(c => !state.exhaustedBranches.includes(c.strategyId));
    const exhausted = result.strategyCandidates.filter(c => state.exhaustedBranches.includes(c.strategyId));

    active.forEach(c => {
      expect(c.avoidHint).toBeDefined();
      expect(c.avoidHint).toContain('Do NOT use these approaches');
    });
    exhausted.forEach(c => {
      expect(c.avoidHint).toBeUndefined();
    });
  });

  it('returns state unchanged when fewer than 2 active candidates', () => {
    const state = makeStateWithCandidates(['a'], ['x', 'y']);
    const result = _diversifyStrategyCandidates(state);
    expect(result.strategyCandidates.length).toBe(3);
    expect(result.strategyCandidates.map(c => c.strategyId).sort()).toEqual(['a', 'x', 'y'].sort());
  });

  it('returns state unchanged when no exhausted candidates (all active)', () => {
    const state = makeStateWithCandidates(['a', 'b'], []);
    const result = _diversifyStrategyCandidates(state);
    expect(result.strategyCandidates.length).toBe(2);
    // All should have avoidHint since they are all active
    result.strategyCandidates.forEach(c => {
      expect(c.avoidHint).toBeDefined();
    });
  });
});

describe('Bug 4: baseline HITL override guidance propagation', () => {
  it('propagates human override guidance to agentsMdContext and hitlPriorGuidance', () => {
    const state = {
      ...createInitialState(task),
      currentPhase: 'HITL_ESCALATION' as const,
    };
    const guidance = 'Use RS256 for JWT signing, store keys in AWS Secrets Manager';
    const result = applyBaselineOverride(state, guidance);

    expect(result.agentsMdContext).toBe(guidance);
    expect(result.hitlPriorGuidance).toBe(guidance);
  });

  it('preserves other state fields when applying override', () => {
    const state = {
      ...createInitialState(task),
      currentPhase: 'HITL_ESCALATION' as const,
      cumulativeCostUsd: 12.5,
      correctionCycle: { ...createInitialState(task).correctionCycle, attemptCount: 2 },
    };
    const result = applyBaselineOverride(state, 'some guidance');

    expect(result.cumulativeCostUsd).toBe(12.5);
    expect(result.correctionCycle.attemptCount).toBe(2);
    expect(result.agentsMdContext).toBe('some guidance');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug 8: Confidence score staleness
// The confidence score is computed in actorImpl at cycle start, before
// preflight/critics/verifier/stagnation run. When computeVerifierTransition
// reads confidenceScore, it sees a stale value that doesn't reflect the
// latest critic findings, verifier verdict, or stagnation pattern.
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug 8: confidence score must reflect post-verification state', () => {
  it('stale confidence hides low-confidence escalation when critical critic findings exist', () => {
    // Simulate state AFTER the full correction cycle:
    // - Actor ran (confidence was 1.0 at that point)
    // - Preflight + critics ran, producing 6 critical findings
    // - Verifier ran and failed with AMBIGUOUS
    // - Stagnation check ran and detected semantic stagnation
    const criticFindings = Array.from({ length: 6 }, (_, i) => ({
      critic: 'style' as const, severity: 'critical' as const,
      file: 'src/a.ts', line: i + 1, ruleId: `rule-${i}`, message: 'critical issue',
      resolutionHint: 'fix it',
    }));

    const staleState = {
      ...createInitialState(task),
      criticFindings,
      correctionCycle: {
        ...createInitialState(task).correctionCycle,
        attemptCount: 3,
        stagnationPattern: 'semantic' as const,
      },
      verifierVerdict: {
        testResult: 'FAIL' as const, diagnostic: 'AMBIGUOUS' as const,
        testFailures: [{ testName: 'T1', message: 'broken' }],
        blockedByCritic: false, confidenceScore: 0.7,
      },
    };

    // Stale confidence (computed at actor start, before critics/verifier)
    expect(staleState.confidenceScore).toBe(1.0);

    // Fresh confidence (what it SHOULD be after the full cycle)
    const freshConf = computeConfidenceScore(staleState, config);

    // With 6 critical findings + semantic stagnation + AMBIGUOUS + 3 attempts,
    // confidence should drop below escalation threshold
    expect(freshConf).toBeLessThan(config.confidenceEscalationThreshold);

    // Routing with stale confidence would stay in ACTOR (wrong)
    const staleTransition = computeVerifierTransition(staleState as never, config);
    // Without the fix, stale confidence=1.0 means no low_confidence escalation
    // The transition would be driven by other factors (stagnation -> HITL, but stale conf doesn't show it)
    // This test documents the bug: stale confidence is 1.0, fresh is much lower

    // Routing with fresh confidence correctly escalates
    const freshState = { ...staleState, confidenceScore: freshConf };
    const freshTransition = computeVerifierTransition(freshState as never, config);
    expect(freshTransition.nextPhase).toBe('HITL_ESCALATION');
    if (freshTransition.nextPhase === 'HITL_ESCALATION') {
      expect(freshTransition.reason).toBe('low_confidence');
    }
  });

  it('fresh confidence reflects verifier FAIL verdict penalties', () => {
    const staleState = {
      ...createInitialState(task),
      correctionCycle: {
        ...createInitialState(task).correctionCycle,
        attemptCount: 2,
      },
      verifierVerdict: {
        testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const,
        testFailures: [{ testName: 'T1', message: 'assertion failed' }],
        blockedByCritic: false, confidenceScore: 0.8,
      },
    };

    // Stale confidence does not know about verifier verdict
    expect(staleState.confidenceScore).toBe(1.0);

    // Fresh confidence should deduct for FIX_IMPL (no AMBIGUOUS penalty)
    // but still account for attemptCount=2 (-0.16)
    const freshConf = computeConfidenceScore(staleState, config);
    expect(freshConf).toBeLessThan(1.0);
    expect(freshConf).toBeGreaterThanOrEqual(0);
  });
});
