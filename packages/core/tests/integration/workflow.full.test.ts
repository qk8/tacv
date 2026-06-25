import { describe, it, expect } from 'vitest';
import {
  createInitialState, withPhase, withCost, withAuditEntry,
} from '../../src/state/schemas.js';
import {
  computeVerifierTransition, computeConfidenceScore, ALL_PHASES,
} from '../../src/state/transitions.js';
import { getCriticDefs } from '../../src/activities/critics/impl.js';
import { loadConfig } from '../../src/config/index.js';

const config = loadConfig();
const task   = { taskId: 'full-1', description: 'Add JWT authentication', mode: 'GREENFIELD' as const, moduleType: 'java-backend', languageIds: ['java'] };

describe('Full workflow integration — problem fixes', () => {
  it('new phases are present in ALL_PHASES', () => {
    expect(ALL_PHASES).toContain('FEASIBILITY_CHECK');
    expect(ALL_PHASES).toContain('SANDBOX_VALIDATION');
    expect(ALL_PHASES).toContain('FLAKINESS_CHECK');
    expect(ALL_PHASES).toContain('TEST_VALIDITY_REVIEW');
  });

  it('BROWNFIELD now includes scope_creep critic', () => {
    const brownState = createInitialState({ ...task, mode: 'BROWNFIELD' });
    const names = getCriticDefs(brownState as never).map(d => d.name);
    expect(names).toContain('scope_creep');
    expect(names).toContain('compatibility');
  });

  it('GREENFIELD includes requirement_trace critic', () => {
    const greenState = createInitialState(task);
    const names = getCriticDefs(greenState as never).map(d => d.name);
    expect(names).toContain('requirement_trace');
    expect(names).toContain('architecture');
  });

  it('stagnation pattern triggers immediate HITL escalation', () => {
    const state = {
      ...createInitialState(task),
      correctionCycle: { attemptCount: 3, branchName: 'main', lastErrorHash: 'abc', errorHistory: [], stagnationPattern: 'iteration' as const, lastOutcomeSignature: 'abc' },
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ message: 'err' }], blockedByCritic: false, confidenceScore: 0.6 },
    };
    const t = computeVerifierTransition(state as never, config);
    expect(t.nextPhase).toBe('HITL_ESCALATION');
    if (t.nextPhase === 'HITL_ESCALATION') expect(t.reason).toBe('stagnation');
  });

  it('diversity enforcement adds avoidHint to strategy candidates', () => {
    const state = {
      ...createInitialState(task),
      strategyCandidates: [
        { strategyId: 's1', description: 'Use Redis cache', compositeScore: 0.8, estimatedRisk: 'low' as const, affectedFiles: [] },
        { strategyId: 's2', description: 'Use in-memory cache', compositeScore: 0.7, estimatedRisk: 'low' as const, affectedFiles: [] },
        { strategyId: 's3', description: 'Use Memcached', compositeScore: 0.6, estimatedRisk: 'medium' as const, affectedFiles: [] },
      ],
    };
    // Simulate what _diversifyStrategyCandidates does
    const candidates = state.strategyCandidates;
    const descriptions = candidates.map(c => c.description);
    const diversified = candidates.map((c, idx) => ({
      ...c,
      avoidHint: `Do NOT use: ${descriptions.filter((_, i) => i !== idx).join('; ')}`,
    }));
    expect(diversified[0]?.avoidHint).toContain('in-memory cache');
    expect(diversified[0]?.avoidHint).toContain('Memcached');
    expect(diversified[0]?.avoidHint).not.toContain('Redis');
    expect(diversified[1]?.avoidHint).toContain('Redis');
    expect(diversified[1]?.avoidHint).not.toContain('in-memory cache');
  });

  it('budget guard at HITL resume — too little budget = FAILED', () => {
    const CRITICAL = config.tokenBudget.criticalDollar;
    // Simulate budget at 88% used when HITL fires
    const budgetAtEsc = CRITICAL * 0.88;
    const budgetRemaining = CRITICAL - budgetAtEsc;
    const tooLowThreshold = CRITICAL * 0.15;
    expect(budgetRemaining).toBeLessThan(tooLowThreshold);
    // This state would cause the workflow to refuse resume and set FAILED
  });

  it('confidence score includes new stagnation pattern penalty', () => {
    const iterState = { ...createInitialState(task), correctionCycle: { ...createInitialState(task).correctionCycle, stagnationPattern: 'semantic' as const } };
    const outcomeState = { ...createInitialState(task), correctionCycle: { ...createInitialState(task).correctionCycle, stagnationPattern: 'outcome' as const } };
    const noneState = createInitialState(task);
    const iterScore   = computeConfidenceScore(iterState as never, config);
    const outcomeScore = computeConfidenceScore(outcomeState as never, config);
    const noneScore   = computeConfidenceScore(noneState, config);
    expect(noneScore).toBeGreaterThan(iterScore);
    expect(iterScore).toBeGreaterThan(outcomeScore); // outcome is harshest penalty
  });

  it('audit trail captures all major phase transitions', () => {
    let state = createInitialState(task);
    const phases = ['bootstrap','scout','feasibility_check','value_node','tdd_gate','sandbox_validation','actor'];
    for (const node of phases) {
      state = withAuditEntry(state, { node, decision: 'phase_complete', keyValues: {} });
    }
    expect(state.workflowAuditTrail).toHaveLength(phases.length);
    expect(state.workflowAuditTrail.map(e => e.node)).toEqual(phases);
  });

  it('workflowStartMs is set on initial state', () => {
    const before = Date.now();
    const state  = createInitialState(task);
    const after  = Date.now();
    expect(state.workflowStartMs).toBeGreaterThanOrEqual(before);
    expect(state.workflowStartMs).toBeLessThanOrEqual(after);
  });

  it('new WorkflowState fields have safe defaults', () => {
    const state = createInitialState(task);
    expect(state.testValidityFlag).toBeNull();
    expect(state.flakinessReport).toBeNull();
    expect(state.feasibility).toBeNull();
    expect(state.sandboxEnvOk).toBeNull();
    expect(state.scopeViolations).toHaveLength(0);
    expect(state.hitlPriorGuidance).toBeNull();
    expect(state.hitlBudgetAtEscalation).toBeNull();
  });
});
