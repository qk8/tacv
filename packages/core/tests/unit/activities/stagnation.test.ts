import { describe, it, expect } from 'vitest';
import {
  computeErrorHash,
  detectStagnationPattern,
  computeTextSimilarity,
  extractMeaningfulWords,
  checkStagnationImpl,
} from '../../../src/activities/stagnation/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';

const task = { taskId: 's1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

const freshCycle = () => ({
  attemptCount: 0, branchName: null, lastErrorHash: null,
  errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null,
});

describe('extractMeaningfulWords', () => {
  it('extracts words 4+ chars, lowercased', () => {
    const words = extractMeaningfulWords('TypeError: Cannot read property');
    expect(words).toContain('typeerror');
    expect(words).toContain('cannot');
    expect(words).toContain('read');
    expect(words).toContain('property');
  });

  it('strips punctuation', () => {
    const words = extractMeaningfulWords("Expected 'foo' but got 'bar'");
    expect(words).toContain('expected');
  });

  it('deduplicates words', () => {
    const words = extractMeaningfulWords('error error error undefined undefined');
    const unique = new Set(words);
    expect(unique.size).toBe(words.length);
  });
});

describe('computeTextSimilarity (Jaccard)', () => {
  it('returns 1.0 for identical text', () => {
    const t = 'Cannot read property foo of undefined';
    expect(computeTextSimilarity(t, t)).toBe(1.0);
  });

  it('returns 0 for completely different text', () => {
    const sim = computeTextSimilarity('timeout error in payment gateway', 'null pointer exception in auth');
    expect(sim).toBeLessThan(0.2);
  });

  it('detects similarity between Node.js version variants of same error', () => {
    const a = "Cannot read property 'foo' of undefined";
    const b = "Cannot read properties of undefined (reading 'foo')";
    const sim = computeTextSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.3);
  });

  it('scores higher for similar errors than different ones', () => {
    const base = 'AssertionError: expected true but got false in UserService';
    const similar = 'AssertionError: expected true but got false in OrderService';
    const different = 'TypeError: Cannot read property name of null';
    expect(computeTextSimilarity(base, similar)).toBeGreaterThan(computeTextSimilarity(base, different));
  });
});

describe('computeErrorHash', () => {
  it('is deterministic', () => {
    const msgs = ['error A', 'error B'];
    expect(computeErrorHash(msgs)).toBe(computeErrorHash(msgs));
  });

  it('produces different hashes for different error sets', () => {
    expect(computeErrorHash(['error A'])).not.toBe(computeErrorHash(['error B']));
  });

  it('is order-independent', () => {
    expect(computeErrorHash(['B', 'A'])).toBe(computeErrorHash(['A', 'B']));
  });
});

describe('detectStagnationPattern (Jaccard-based)', () => {
  it('returns none on attempt < 2', () => {
    const cycle = { ...freshCycle(), attemptCount: 1 };
    expect(detectStagnationPattern(cycle, computeErrorHash(['err']))).toBe('none');
  });

  it('detects iteration stagnation on identical hash', () => {
    const hash = computeErrorHash(['same error']);
    const cycle = { ...freshCycle(), attemptCount: 2, lastErrorHash: hash, errorHistory: [hash] };
    expect(detectStagnationPattern(cycle, hash)).toBe('iteration');
  });

  it('detects outcome stagnation on recurring hash', () => {
    const hash = computeErrorHash(['recurring error']);
    const cycle = { ...freshCycle(), attemptCount: 4, lastErrorHash: computeErrorHash(['different']), errorHistory: [hash, computeErrorHash(['other']), computeErrorHash(['another'])] };
    expect(detectStagnationPattern(cycle, hash)).toBe('outcome');
  });

  it('detects semantic stagnation via Jaccard for similar error messages', () => {
    const err1 = "Cannot read property 'userId' of undefined at UserService.ts:42";
    const err2 = "Cannot read properties of undefined (reading 'userId') at UserService.ts:42";
    const err3 = "TypeError: Cannot read 'userId' from undefined in UserService";
    const h1 = computeErrorHash([err1]);
    const h2 = computeErrorHash([err2]);
    const h3 = computeErrorHash([err3]);
    expect(h1).not.toBe(h2);
    const cycle = { ...freshCycle(), attemptCount: 4, lastErrorHash: h1, errorHistory: [h1, h2] };
    const pattern = detectStagnationPattern(cycle, h3, 0.4, [err3], [err1, err2]);
    expect(pattern).toBe('semantic');
  });

  it('returns none when errors are genuinely different', () => {
    const h1 = computeErrorHash(['Payment timeout after 30s']);
    const h2 = computeErrorHash(['NullPointerException in UserRepository line 88']);
    const cycle = { ...freshCycle(), attemptCount: 3, lastErrorHash: h1, errorHistory: [h1] };
    expect(detectStagnationPattern(cycle, h2, 0.4, ['NullPointerException in UserRepository line 88'], ['Payment timeout after 30s'])).toBe('none');
  });
});

describe('checkStagnationImpl', () => {
  it('returns none when no failures', () => {
    const state = { ...createInitialState(task), verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [], blockedByCritic: false, confidenceScore: 0.8 } };
    expect(checkStagnationImpl(state as never).pattern).toBe('none');
  });

  it('detects iteration when same message repeats', () => {
    const msg = 'AssertionError: expected 1 to equal 2';
    const hash = computeErrorHash([msg]);
    const state = {
      ...createInitialState(task),
      correctionCycle: { ...freshCycle(), attemptCount: 3, lastErrorHash: hash, errorHistory: [hash] },
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ message: msg }], blockedByCritic: false, confidenceScore: 0.7 },
    };
    expect(checkStagnationImpl(state as never).pattern).toBe('iteration');
  });

  it('newCycle has updated errorHistory', () => {
    const state = {
      ...createInitialState(task),
      correctionCycle: { ...freshCycle(), attemptCount: 1 },
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ message: 'err one' }], blockedByCritic: false, confidenceScore: 0.9 },
    };
    const { newCycle } = checkStagnationImpl(state as never);
    expect(newCycle.lastErrorHash).not.toBeNull();
    expect(newCycle.errorHistory).toHaveLength(1);
  });
});
