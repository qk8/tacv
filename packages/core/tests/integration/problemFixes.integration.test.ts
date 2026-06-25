import { describe, it, expect } from 'vitest';
import {
  createInitialState, withPhase, withCost, withAuditEntry,
  type WorkflowState,
} from '../../src/state/schemas.js';
import { computeVerifierTransition, computeConfidenceScore } from '../../src/state/transitions.js';
import { loadConfig } from '../../src/config/index.js';

const config = loadConfig();

const task = {
  taskId: 'pf-int-1',
  description: 'Add rate limiting: 100 req/min per user, not per IP',
  mode: 'BROWNFIELD' as const,
  moduleType: 'java-backend',
  languageIds: ['java'],
};

function make(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return { ...createInitialState(task), workflowStartMs: Date.now(), ...overrides };
}

describe('Problem fixes — integration', () => {
  // ── Fix 1: Faulty test path ─────────────────────────────────────────────
  describe('Fix 1: Faulty test detection', () => {
    it('testValidityFlag is null in initial state', () => {
      expect(createInitialState(task).testValidityFlag).toBeNull();
    });

    it('state holds testValidityFlag when set', () => {
      const state = make({
        testValidityFlag: {
          suspected: true,
          affectedTests: ['findById test'],
          proposedFixes: [{ testFile: 'UserService.test.ts', currentAssertion: 'toBeNull()', suggestedFix: 'toMatchObject({id:1})', justification: 'Inverted assertion' }],
          confidence: 0.9,
          detectedAtCycle: 2,
        },
      });
      expect(state.testValidityFlag?.suspected).toBe(true);
      expect(state.testValidityFlag?.proposedFixes).toHaveLength(1);
    });
  });

  // ── Fix 4: Flakiness ────────────────────────────────────────────────────
  describe('Fix 4: Flakiness report in state', () => {
    it('flakinessReport is null initially', () => {
      expect(createInitialState(task).flakinessReport).toBeNull();
    });

    it('flakinessReport survives state spread', () => {
      const state = make({ flakinessReport: { flakyTests: [{ testFile: 'src/A.test.ts', passRate: 0.67, runCount: 3 }], detectedAt: 2 } });
      const updated = withPhase(state, 'ACTOR');
      expect(updated.flakinessReport?.flakyTests).toHaveLength(1);
      expect(updated.flakinessReport?.flakyTests[0]?.passRate).toBeCloseTo(0.67);
    });
  });

  // ── Fix 6: Scope creep ──────────────────────────────────────────────────
  describe('Fix 6: Scope violations tracked in state', () => {
    it('scopeViolations is empty initially', () => {
      expect(createInitialState(task).scopeViolations).toHaveLength(0);
    });

    it('scopeViolations accumulate from critics', () => {
      const state = make({ scopeViolations: [{ file: 'src/EmailService.ts', reason: 'Unrelated to rate limiting' }, { file: 'src/Config.ts', reason: 'Not required by task' }] });
      expect(state.scopeViolations).toHaveLength(2);
    });
  });

  // ── Fix 10: HITL budget tracking ────────────────────────────────────────
  describe('Fix 10: HITL budget snapshot', () => {
    it('hitlBudgetAtEscalation is null initially', () => {
      expect(createInitialState(task).hitlBudgetAtEscalation).toBeNull();
    });

    it('hitlPriorGuidance carries forward', () => {
      const state = make({ hitlPriorGuidance: 'Use constructor injection' });
      const updated = withPhase(state, 'ACTOR');
      expect(updated.hitlPriorGuidance).toBe('Use constructor injection');
    });
  });

  // ── Fix 11: Feasibility check ───────────────────────────────────────────
  describe('Fix 11: Feasibility in workflow state', () => {
    it('feasibility is null initially', () => {
      expect(createInitialState(task).feasibility).toBeNull();
    });

    it('low-ambiguity assessment does not escalate', () => {
      const state = make({ feasibility: { ambiguity: 1, complexity: 2, risk: 1, ambiguities: [], shouldEscalateEarly: false, escalationReason: null } });
      expect(state.feasibility?.shouldEscalateEarly).toBe(false);
    });
  });

  // ── Fix 9: Diversity enforcement ────────────────────────────────────────
  describe('Fix 9: Speculative branch diversity', () => {
    it('avoidHint is optional in StrategyCandidate', () => {
      const state = make({
        strategyCandidates: [
          { strategyId: 's1', description: 'Redis approach', compositeScore: 0.8, estimatedRisk: 'low', affectedFiles: [] },
          { strategyId: 's2', description: 'DB approach', compositeScore: 0.7, estimatedRisk: 'medium', affectedFiles: [], avoidHint: 'Do not use Redis' },
        ],
      });
      expect(state.strategyCandidates[0]?.avoidHint).toBeUndefined();
      expect(state.strategyCandidates[1]?.avoidHint).toContain('Do not use Redis');
    });
  });

  // ── Full routing behaviour with new phases ──────────────────────────────
  describe('Routing correctness with all fixes applied', () => {
    it('PASS still routes to MEMORY_CONSOLIDATION', () => {
      const state = make({ verifierVerdict: { testResult: 'PASS', diagnostic: 'PASS', testFailures: [], blockedByCritic: false, confidenceScore: 1.0 } });
      expect(computeVerifierTransition(state, config).nextPhase).toBe('MEMORY_CONSOLIDATION');
    });

    it('stagnation escalates to HITL', () => {
      const state = make({
        correctionCycle: { attemptCount: 3, branchName: 'main', lastErrorHash: 'abc', errorHistory: ['abc','abc'], stagnationPattern: 'iteration', lastOutcomeSignature: 'abc' },
        verifierVerdict: { testResult: 'FAIL', diagnostic: 'FIX_IMPL', testFailures: [], blockedByCritic: false, confidenceScore: 0.7 },
      });
      const t = computeVerifierTransition(state, config);
      expect(t.nextPhase).toBe('HITL_ESCALATION');
      if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('stagnation');
    });

    it('confidenceScore always in [0,1] with problem-fix state fields', () => {
      const combinations = [
        make({ correctionCycle: { attemptCount: 5, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'semantic', lastOutcomeSignature: null }, cumulativeCostUsd: 65 }),
        make({ correctionCycle: { attemptCount: 0, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none', lastOutcomeSignature: null }, cumulativeCostUsd: 0 }),
        make({ correctionCycle: { attemptCount: 6, branchName: 'main', lastErrorHash: 'x', errorHistory: ['x','x','x'], stagnationPattern: 'outcome', lastOutcomeSignature: 'x' }, cumulativeCostUsd: 79 }),
      ];
      for (const s of combinations) {
        const score = computeConfidenceScore(s, config);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    it('audit trail captures all new phase nodes', () => {
      let state = createInitialState(task);
      const nodes = ['bootstrap', 'feasibility_check', 'scout', 'tdd_gate', 'sandbox_validation', 'critics', 'verifier'];
      for (const node of nodes) {
        state = withAuditEntry(state, { node, decision: `${node}_complete`, keyValues: {} });
      }
      expect(state.workflowAuditTrail).toHaveLength(7);
      expect(state.workflowAuditTrail.map(e => e.node)).toEqual(nodes);
    });
  });
});
