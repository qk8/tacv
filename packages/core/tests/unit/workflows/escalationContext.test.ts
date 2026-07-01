import { describe, it, expect } from 'vitest';
import { buildEscalationContext } from '../../../src/workflows/escalationContext.js';
import { createInitialState, type WorkflowState } from '../../../src/state/schemas.js';

const task = { taskId: 'esc1', description: 'Add auth', mode: 'BROWNFIELD' as const, moduleType: 'ts-backend', languageIds: ['typescript'] };

describe('buildEscalationContext', () => {
  it('produces an empty root-cause summary when there are no critic findings', () => {
    const ctx = buildEscalationContext(createInitialState(task), 'budget_exceeded');
    expect(ctx.rootCauseSummary).toBe('');
  });

  it('synthesizes a non-empty root-cause summary from accumulated critic findings', () => {
    const state: WorkflowState = {
      ...createInitialState(task),
      criticFindings: [
        { critic: 'security', severity: 'critical', file: 'a.ts', line: 1, ruleId: 'R1', message: 'm1', resolutionHint: 'fix1' },
        { critic: 'style', severity: 'warning', file: 'a.ts', line: 2, ruleId: 'R2', message: 'm2', resolutionHint: 'fix1' },
      ],
    };
    const ctx = buildEscalationContext(state, 'stagnation');
    expect(ctx.rootCauseSummary.length).toBeGreaterThan(0);
    expect(ctx.rootCauseSummary).toContain('fix1');
  });

  it('extracts tried-approach count from the accumulated session scratchpad into the targeted question summary', () => {
    const state: WorkflowState = {
      ...createInitialState(task),
      sessionScratchpad: 'Cycle 1: tried JWT HS256, failed.\nCycle 2: tried JWT RS256, failed.',
    };
    const ctx = buildEscalationContext(state, 'stagnation');
    expect(ctx.targetedQuestion.summary).toMatch(/2/);
  });

  it('passes the recorded errorType through to produce a specialized stagnation question', () => {
    const state: WorkflowState = {
      ...createInitialState(task),
      debugObservations: {
        errorType: 'BEAN_CREATION_ERROR', rootCause: 'circular dependency',
        breakpointHits: [], actuatorBeans: null, actuatorEnv: null, minimalPayload: null,
        playwrightTracePath: null, prunedStack: [],
      },
    };
    const ctx = buildEscalationContext(state, 'stagnation');
    expect(ctx.targetedQuestion.question.toLowerCase()).toMatch(/bean|spring|dependency injection/);
  });

  it('passes affected tests through for test-fault escalations', () => {
    const state: WorkflowState = {
      ...createInitialState(task),
      testValidityFlag: { verdict: 'TEST_FAULT', affectedTests: ['AuthTest.shouldReject'], proposedFixes: [] },
    };
    const ctx = buildEscalationContext(state, 'test_fault_needs_human_approval');
    expect(ctx.targetedQuestion.summary).toContain('AuthTest.shouldReject');
  });

  it('passes cumulative cost through for budget escalations', () => {
    const state: WorkflowState = { ...createInitialState(task), cumulativeCostUsd: 73.2 };
    const ctx = buildEscalationContext(state, 'budget_exceeded');
    expect(ctx.targetedQuestion.question).toMatch(/73\.2/);
  });
});
