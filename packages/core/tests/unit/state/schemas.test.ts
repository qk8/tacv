import { describe, it, expect } from 'vitest';
import { createInitialState, withPhase, withCost, withAuditEntry, TaskSpec, WorkflowState } from '../../../src/state/schemas.js';

const task: import('../../../src/state/schemas.js').TaskSpec = { taskId: 'test-1', description: 'Add a user endpoint', mode: 'GREENFIELD', moduleType: 'java-backend', languageIds: ['java'] };

describe('createInitialState', () => {
  it('creates valid state from task', () => {
    const s = createInitialState(task);
    expect(s.taskId).toBe('test-1');
    expect(s.currentPhase).toBe('BOOTSTRAP');
    expect(s.correctionCycle.attemptCount).toBe(0);
    expect(s.correctionCycle.lastOutcomeSignature).toBeNull();
    expect(s.cumulativeCostUsd).toBe(0);
    expect(s.workflowAuditTrail).toHaveLength(0);
  });

  it('generates a unique sessionId each call', () => {
    const s1 = createInitialState(task);
    const s2 = createInitialState(task);
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });

  it('caps workflowAuditTrail at 200 entries with smart pruning', () => {
    let s = createInitialState(task);
    for (let i = 0; i < 250; i++) {
      s = withAuditEntry(s, { node: 'test', decision: `step_${i}`, keyValues: {} });
    }
    expect(s.workflowAuditTrail.length).toBeLessThanOrEqual(200);
  });
});

describe('withPhase', () => {
  it('transitions phase immutably', () => {
    const s = createInitialState(task);
    const s2 = withPhase(s, 'SCOUT');
    expect(s.currentPhase).toBe('BOOTSTRAP');
    expect(s2.currentPhase).toBe('SCOUT');
  });
});

describe('withCost', () => {
  it('updates cost immutably', () => {
    const s = createInitialState(task);
    const s2 = withCost(s, 5.5);
    expect(s.cumulativeCostUsd).toBe(0);
    expect(s2.cumulativeCostUsd).toBe(5.5);
  });
});

describe('TaskSpec validation', () => {
  it('rejects empty taskId', () => {
    expect(() => TaskSpec.parse({ ...task, taskId: '' })).toThrow();
  });
  it('rejects empty languageIds', () => {
    expect(() => TaskSpec.parse({ ...task, languageIds: [] })).toThrow();
  });
  it('rejects invalid mode', () => {
    expect(() => TaskSpec.parse({ ...task, mode: 'INVALID' })).toThrow();
  });
});

describe('createInitialState — deterministic sessionId', () => {
  it('accepts an optional sessionId for Temporal determinism', () => {
    const s = createInitialState(task, 'workflow-id-123');
    expect(s.sessionId).toBe('workflow-id-123');
  });

  it('still generates unique sessionId when no sessionId is passed', () => {
    const s1 = createInitialState(task);
    const s2 = createInitialState(task);
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });
});
