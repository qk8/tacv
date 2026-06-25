import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialState, withPhase, withCost, withAuditEntry } from '../../src/state/schemas.js';
import { computeVerifierTransition, computeConfidenceScore } from '../../src/state/transitions.js';
import { getCriticDefs } from '../../src/activities/critics/impl.js';
import { loadConfig } from '../../src/config/index.js';

const task = { taskId: 'int-1', description: 'Integration test task', mode: 'GREENFIELD' as const, moduleType: 'java-backend', languageIds: ['java'] };

describe('Workflow state machine integration', () => {
  const config = loadConfig();

  it('follows the happy path to MEMORY_CONSOLIDATION on PASS', () => {
    let state = createInitialState(task);
    state = { ...state, verifierVerdict: { testResult: 'PASS', diagnostic: 'PASS', testFailures: [], blockedByCritic: false, confidenceScore: 1.0 } };
    expect(computeVerifierTransition(state, config).nextPhase).toBe('MEMORY_CONSOLIDATION');
  });

  it('escalates when budget exceeded', () => {
    let state = createInitialState(task);
    state = withCost(state, 85);
    state = { ...state, verifierVerdict: { testResult: 'FAIL', diagnostic: 'FIX_IMPL', testFailures: [{ message: 'err' }], blockedByCritic: false, confidenceScore: 0.7 } };
    const t = computeVerifierTransition(state, config);
    expect(t.nextPhase).toBe('HITL_ESCALATION');
    if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('budget_exceeded');
  });

  it('GREENFIELD has architecture critic, BROWNFIELD has compatibility critic', () => {
    const g = createInitialState({ ...task, mode: 'GREENFIELD' });
    const b = createInitialState({ ...task, mode: 'BROWNFIELD' });
    expect(getCriticDefs(g as never).map(d => d.name)).toContain('architecture');
    expect(getCriticDefs(b as never).map(d => d.name)).toContain('compatibility');
    expect(getCriticDefs(g as never).map(d => d.name)).not.toContain('compatibility');
  });

  it('audit trail records all transitions', () => {
    let state = createInitialState(task);
    state = withAuditEntry(state, { node: 'bootstrap', decision: 'started', keyValues: {} });
    state = withAuditEntry(state, { node: 'scout',     decision: 'context_built', keyValues: { strategies: 3 } });
    expect(state.workflowAuditTrail).toHaveLength(2);
    expect(state.workflowAuditTrail[0]?.node).toBe('bootstrap');
  });

  it('confidence decreases monotonically with attempts', () => {
    const scores = [0,1,2,3,4,5].map(n => {
      const s = { ...createInitialState(task), correctionCycle: { attemptCount: n, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null } };
      return computeConfidenceScore(s, config);
    });
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeLessThanOrEqual(scores[i-1]!);
  });

  it('withPhase is immutable', () => {
    const s1 = createInitialState(task);
    const s2 = withPhase(s1, 'SCOUT');
    expect(s1.currentPhase).toBe('BOOTSTRAP');
    expect(s2.currentPhase).toBe('SCOUT');
  });
});
