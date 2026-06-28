import { describe, it, expect } from 'vitest';
import { actorImpl } from '../../../src/activities/actor/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

/**
 * Issue 22: actorImpl prompt version not stored in state.
 *
 * ACTOR_PROMPT_VERSION is logged but never stored in the audit trail.
 * If the prompt changes between deployments and a workflow resumes,
 * the audit trail shows no indication of which prompt version was used.
 */

const task = { taskId: 'test', description: 'test task', mode: 'BROWNFIELD' as const, moduleType: 'ts-frontend', languageIds: ['typescript'] };

describe('Issue 22: actor prompt version stored in audit trail', () => {
  it('stores promptVersion in the audit entry keyValues', async () => {
    const state = createInitialState(task);

    const result = await actorImpl(state, makeStubDeps());

    // The last audit entry should contain the prompt version
    const lastEntry = result.workflowAuditTrail.at(-1);
    expect(lastEntry).toBeDefined();
    expect(lastEntry?.node).toBe('actor');
    if (lastEntry) {
      expect(lastEntry.keyValues.promptVersion).toBeDefined();
      expect(lastEntry.keyValues.promptVersion).toBeTypeOf('string');
    }
  });

  it('stores the correct prompt version string', async () => {
    const state = createInitialState(task);

    const result = await actorImpl(state, makeStubDeps());

    const lastEntry = result.workflowAuditTrail.at(-1);
    if (lastEntry) {
      // Should match the version constant defined in actor/impl.ts
      expect(lastEntry.keyValues.promptVersion).toBe('2026-06-15-v2');
    }
  });
});
