import { describe, it, expect } from 'vitest';
import { actorImpl } from '../../../src/activities/actor/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

/**
 * Issue 26: sessionScratchpad grows unboundedly in state.
 *
 * The scratchpad is used in the actor prompt with .slice(0, 500),
 * but in state it grows without limit. For 6 correction cycles ×
 * 100-char entries, this is 600 chars. But in edge cases (long
 * error messages, many cycles), state bloats.
 *
 * The fix: trim at write time to SCRATCHPAD_MAX_CHARS (default 2000).
 */

const task = { taskId: 'test', description: 'test task', mode: 'BROWNFIELD' as const, moduleType: 'ts-frontend', languageIds: ['typescript'] };

function makeStateWithScratchpad(scratchpad: string) {
  return {
    ...createInitialState(task),
    currentPhase: 'ACTOR' as const,
    sessionScratchpad: scratchpad,
    verifierVerdict: {
      testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const,
      testFailures: [{ testName: 'test1', message: 'AssertionError: expected 1 to equal 2' }],
      blockedByCritic: false, confidenceScore: 0.8,
    },
    correctionCycle: {
      ...createInitialState(task).correctionCycle,
      attemptCount: 0,
    },
  };
}

describe('Issue 26: sessionScratchpad bounded growth', () => {
  const SCRATCHPAD_MAX_CHARS = 2000;

  it('trims accumulated scratchpad to max length when existing + new entry exceeds limit', async () => {
    // 1990 chars existing + ~80 char new entry = ~2070 > 2000 limit
    const existingScratchpad = 'x'.repeat(1990);
    const state = makeStateWithScratchpad(existingScratchpad);

    const result = await actorImpl(state, makeStubDeps());

    expect(result.sessionScratchpad).toBeDefined();
    expect(result.sessionScratchpad).toBeTypeOf('string');
    if (result.sessionScratchpad) {
      expect(result.sessionScratchpad.length).toBeLessThanOrEqual(SCRATCHPAD_MAX_CHARS);
    }
  });

  it('keeps the most recent entries when trimming (trailing slice)', async () => {
    const existingScratchpad = 'x'.repeat(1900);
    const state = makeStateWithScratchpad(existingScratchpad);

    const result = await actorImpl(state, makeStubDeps());

    // The last characters should contain the new cycle entry, not only 'x's
    if (result.sessionScratchpad) {
      expect(result.sessionScratchpad).toContain('Cycle 1:');
    }
  });

  it('does not over-trim when scratchpad is under the limit', async () => {
    const state = makeStateWithScratchpad('short entry');

    const result = await actorImpl(state, makeStubDeps());

    if (result.sessionScratchpad) {
      expect(result.sessionScratchpad).toContain('short entry');
      expect(result.sessionScratchpad.length).toBeLessThanOrEqual(SCRATCHPAD_MAX_CHARS);
    }
  });

  it('handles empty scratchpad correctly', async () => {
    const state = makeStateWithScratchpad('');

    const result = await actorImpl(state, makeStubDeps());

    if (result.sessionScratchpad) {
      expect(result.sessionScratchpad).toContain('Cycle 1:');
      expect(result.sessionScratchpad.length).toBeLessThanOrEqual(SCRATCHPAD_MAX_CHARS);
    }
  });
});
