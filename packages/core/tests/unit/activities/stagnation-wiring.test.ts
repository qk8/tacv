import { describe, it, expect } from 'vitest';
import type { WorkflowState } from '../../../src/state/schemas.js';
import { computeErrorHash } from '../../../src/activities/stagnation/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { registerActivities } from '../../../src/activities/registerActivities.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = { taskId: 'stagn-1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return { ...createInitialState(task), ...overrides };
}

describe('stagnation wiring — runStagnationCheck activity', () => {
  it('runStagnationCheck is registered in activities', () => {
    const deps = makeStubDeps();
    const activities = registerActivities(deps);
    expect(activities.runStagnationCheck).toBeDefined();
    expect(typeof activities.runStagnationCheck).toBe('function');
  });

  it('runStagnationCheck updates stagnationPattern when error repeats', async () => {
    const deps = makeStubDeps();
    const activities = registerActivities(deps);
    const msg = 'AssertionError: expected 1 to equal 2';
    const hash = computeErrorHash([msg]);
    const state = makeState({
      correctionCycle: {
        attemptCount: 3, branchName: null, lastErrorHash: hash,
        errorHistory: [hash], stagnationPattern: 'none' as const, lastOutcomeSignature: null,
      },
      verifierVerdict: { testResult: 'FAIL', diagnostic: 'FIX_IMPL', testFailures: [{ message: msg }], blockedByCritic: false, confidenceScore: 0.6 },
    });

    const result = await activities.runStagnationCheck(state);

    expect(result.correctionCycle.stagnationPattern).toBe('iteration');
    expect(result.correctionCycle.lastErrorHash).toBe(hash);
  });

  it('runStagnationCheck updates stagnationPattern to outcome when hash recurs', async () => {
    const deps = makeStubDeps();
    const activities = registerActivities(deps);
    const msg = 'timeout error';
    const hash = computeErrorHash([msg]);
    const other = computeErrorHash(['different error']);
    const state = makeState({
      correctionCycle: {
        attemptCount: 4, branchName: null, lastErrorHash: other,
        errorHistory: [hash, other], stagnationPattern: 'none' as const, lastOutcomeSignature: null,
      },
      verifierVerdict: { testResult: 'FAIL', diagnostic: 'FIX_IMPL', testFailures: [{ message: msg }], blockedByCritic: false, confidenceScore: 0.5 },
    });

    const result = await activities.runStagnationCheck(state);

    expect(result.correctionCycle.stagnationPattern).toBe('outcome');
  });
});
