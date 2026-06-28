import { describe, it, expect } from 'vitest';
import { registerActivities } from '../../../src/activities/registerActivities.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';
import type { WorkflowState } from '../../../src/state/schemas.js';
import { createInitialState } from '../../../src/state/schemas.js';

const task = { taskId: 'tv-1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return { ...createInitialState(task), ...overrides };
}

describe('test validity review wiring — runTestValidityReview activity', () => {
  it('runTestValidityReview is registered in activities', () => {
    const deps = makeStubDeps();
    const activities = registerActivities(deps);
    expect(activities.runTestValidityReview).toBeDefined();
    expect(typeof activities.runTestValidityReview).toBe('function');
  });

  it('runTestValidityReview returns state with ACTOR phase when no failures', async () => {
    const deps = makeStubDeps();
    const activities = registerActivities(deps);
    const state = makeState({
      verifierVerdict: { testResult: 'PASS', diagnostic: 'PASS', testFailures: [], blockedByCritic: false, confidenceScore: 1.0 },
    });

    const result = await activities.runTestValidityReview(state);

    // With no failures, impl returns state with currentPhase ACTOR
    expect(result.currentPhase).toBe('ACTOR');
  });
});
