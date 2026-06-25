import { describe, it, expect } from 'vitest';
import { computeErrorHash, detectStagnationPattern, checkStagnationImpl } from '../../../src/activities/stagnation/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';

const baseTask = { taskId: 't1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('computeErrorHash', () => {
  it('returns same hash for same input', () => {
    expect(computeErrorHash(['error A', 'error B'])).toBe(computeErrorHash(['error A', 'error B']));
  });
  it('is order-independent', () => {
    expect(computeErrorHash(['A', 'B'])).toBe(computeErrorHash(['B', 'A']));
  });
  it('differs for different inputs', () => {
    expect(computeErrorHash(['error X'])).not.toBe(computeErrorHash(['error Y']));
  });
  it('handles empty failures', () => {
    expect(typeof computeErrorHash([])).toBe('string');
  });
});

describe('detectStagnationPattern', () => {
  it('returns none on first attempt', () => {
    const cycle = { attemptCount: 1, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null };
    expect(detectStagnationPattern(cycle, 'abc123')).toBe('none');
  });
  it('returns iteration when same hash repeated', () => {
    const cycle = { attemptCount: 2, branchName: 'main', lastErrorHash: 'abc123', errorHistory: ['abc123'], stagnationPattern: 'none' as const, lastOutcomeSignature: 'abc123' };
    expect(detectStagnationPattern(cycle, 'abc123')).toBe('iteration');
  });
  it('returns outcome when hash appeared before', () => {
    const cycle = { attemptCount: 3, branchName: 'main', lastErrorHash: 'def456', errorHistory: ['abc123', 'def456'], stagnationPattern: 'none' as const, lastOutcomeSignature: 'def456' };
    expect(detectStagnationPattern(cycle, 'abc123')).toBe('outcome');
  });
});

describe('checkStagnationImpl', () => {
  it('detects iteration stagnation across attempts', () => {
    const state = createInitialState(baseTask);
    const stateWithFailures = {
      ...state,
      correctionCycle: { ...state.correctionCycle, attemptCount: 2, lastErrorHash: null, errorHistory: [] },
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ message: 'UserService test failed: expected 200 but got 404' }], blockedByCritic: false, confidenceScore: 0.7 },
    };

    const r1 = checkStagnationImpl(stateWithFailures as never);
    const stateAfterR1 = { ...stateWithFailures, correctionCycle: r1.newCycle };
    const r2 = checkStagnationImpl(stateAfterR1 as never);

    expect(r2.pattern).toBe('iteration');
  });

  it('returns none when errors differ', () => {
    const state = createInitialState(baseTask);
    const s1 = { ...state, correctionCycle: { ...state.correctionCycle, attemptCount: 2 }, verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ message: 'error A' }], blockedByCritic: false, confidenceScore: 0.7 } };
    const r1 = checkStagnationImpl(s1 as never);
    const s2 = { ...s1, correctionCycle: r1.newCycle, verifierVerdict: { ...s1.verifierVerdict, testFailures: [{ message: 'error B' }] } };
    const r2 = checkStagnationImpl(s2 as never);
    expect(r2.pattern).toBe('none');
  });
});
