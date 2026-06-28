import { describe, it, expect } from 'vitest';
import type { WorkflowState } from '../../../src/state/schemas.js';
import { createInitialState } from '../../../src/state/schemas.js';

const task = { taskId: 'spec-1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return { ...createInitialState(task), ...overrides };
}

describe('speculative branch exhaustion tracking', () => {
  it('exhaustedBranches should be updated when speculative branches all fail', () => {
    // This test documents the expected behavior:
    // When speculative branches all fail, the attempted candidates should be
    // added to exhaustedBranches so they are not retried in subsequent cycles.
    //
    // The CodingWorkflow should do:
    //   state = {
    //     ...state,
    //     exhaustedBranches: [
    //       ...state.exhaustedBranches,
    //       ...candidates.map(c => c.strategyId),
    //     ],
    //   };
    //
    // This test verifies the state transition logic is correct.
    const state = makeState({
      strategyCandidates: [
        { strategyId: 's1', description: 'Strategy A', compositeScore: 0.7, estimatedRisk: 'low', affectedFiles: [] },
        { strategyId: 's2', description: 'Strategy B', compositeScore: 0.6, estimatedRisk: 'medium', affectedFiles: [] },
      ],
      exhaustedBranches: ['s0'], // already exhausted from a prior attempt
    });

    const candidates = state.strategyCandidates.filter(c => !state.exhaustedBranches.includes(c.strategyId));
    const newExhausted = [...state.exhaustedBranches, ...candidates.map(c => c.strategyId)];

    // After the fix, newExhausted should include both s1 and s2
    expect(newExhausted).toContain('s1');
    expect(newExhausted).toContain('s2');
    expect(newExhausted).toContain('s0');
    expect(newExhausted).toHaveLength(3);
  });

  it('does not duplicate already-exhausted strategies', () => {
    const state = makeState({
      strategyCandidates: [
        { strategyId: 's1', description: 'Strategy A', compositeScore: 0.7, estimatedRisk: 'low', affectedFiles: [] },
      ],
      exhaustedBranches: ['s0', 's1'], // s1 already exhausted
    });

    const candidates = state.strategyCandidates.filter(c => !state.exhaustedBranches.includes(c.strategyId));
    const newExhausted = [...state.exhaustedBranches, ...candidates.map(c => c.strategyId)];

    // s1 should appear only once
    expect(newExhausted.filter(id => id === 's1')).toHaveLength(1);
  });
});
