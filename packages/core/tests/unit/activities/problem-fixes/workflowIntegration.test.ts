import { describe, it, expect } from 'vitest';
import { createInitialState, withPhase, withCost, withAuditEntry } from '../../../../src/state/schemas.js';
import { computeVerifierTransition, computeConfidenceScore } from '../../../../src/state/transitions.js';
import { loadConfig } from '../../../../src/config/index.js';

const config = loadConfig();
const task = { taskId: 'wi1', description: 'Implement JWT auth', mode: 'GREENFIELD' as const, moduleType: 'java-backend', languageIds: ['java'] };

describe('Workflow integration — problem fixes', () => {
  it('new phases are in ALL_PHASES', async () => {
    const { ALL_PHASES } = await import('../../../../src/state/transitions.js');
    expect(ALL_PHASES).toContain('FEASIBILITY_CHECK');
    expect(ALL_PHASES).toContain('SANDBOX_VALIDATION');
    expect(ALL_PHASES).toContain('FLAKINESS_CHECK');
    expect(ALL_PHASES).toContain('TEST_VALIDITY_REVIEW');
  });

  it('WorkflowState includes all new problem-fix fields', () => {
    const state = createInitialState(task);
    expect(state.testValidityFlag).toBeNull();
    expect(state.flakinessReport).toBeNull();
    expect(state.feasibility).toBeNull();
    expect(state.sandboxEnvOk).toBeNull();
    expect(state.scopeViolations).toHaveLength(0);
    expect(state.hitlPriorGuidance).toBeNull();
    expect(state.hitlBudgetAtEscalation).toBeNull();
    expect(state.workflowStartMs).toBeGreaterThan(0);
  });

  it('budget_exceeded escalation fires at criticalDollar', () => {
    const state = withCost({ ...createInitialState(task), verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [], blockedByCritic: false, confidenceScore: 0.8 } } as never, 80);
    const t = computeVerifierTransition(state as never, config);
    expect(t.nextPhase).toBe('HITL_ESCALATION');
    if (t.nextPhase === 'HITL_ESCALATION') {
      expect(t.reason).toBe('budget_exceeded');
      expect(t.cost).toBe(80);
    }
  });

  it('stagnation triggers HITL with stagnation reason', () => {
    const state = {
      ...createInitialState(task),
      correctionCycle: { attemptCount: 3, branchName: 'main', lastErrorHash: 'abc', errorHistory: ['abc','abc','abc'], stagnationPattern: 'iteration' as const, lastOutcomeSignature: 'abc' },
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [], blockedByCritic: false, confidenceScore: 0.6 },
    };
    const t = computeVerifierTransition(state as never, config);
    expect(t.nextPhase).toBe('HITL_ESCALATION');
    if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('stagnation');
  });

  it('confidence decreases with increasing attempt count', () => {
    const scores = [0, 1, 2, 3, 4].map(n => {
      const s = { ...createInitialState(task), correctionCycle: { attemptCount: n, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null } };
      return computeConfidenceScore(s as never, config);
    });
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });

  it('audit trail is capped at 100 entries', () => {
    let state = createInitialState(task);
    for (let i = 0; i < 110; i++) {
      state = withAuditEntry(state, { node: 'test', decision: `step_${i}`, keyValues: {} });
    }
    expect(state.workflowAuditTrail.length).toBeLessThanOrEqual(100);
  });

  it('PASS always goes to MEMORY_CONSOLIDATION regardless of budget', () => {
    const state = withCost({ ...createInitialState(task), verifierVerdict: { testResult: 'PASS' as const, diagnostic: 'PASS' as const, testFailures: [], blockedByCritic: false, confidenceScore: 1.0 } } as never, 75);
    expect(computeVerifierTransition(state as never, config).nextPhase).toBe('MEMORY_CONSOLIDATION');
  });

  it('speculative branching after 2+ failures with candidates', () => {
    const state = {
      ...createInitialState(task),
      correctionCycle: { attemptCount: 2, branchName: 'main', lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
      strategyCandidates: [{ strategyId: 's1', description: 'alt', compositeScore: 0.7, estimatedRisk: 'low' as const, affectedFiles: [] }],
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ message: 'failure' }], blockedByCritic: false, confidenceScore: 0.7 },
    };
    expect(computeVerifierTransition(state as never, config).nextPhase).toBe('SPECULATIVE_BRANCH');
  });
});
