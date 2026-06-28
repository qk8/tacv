import { describe, it, expect } from 'vitest';
import { testValidityReviewImpl } from '../../../src/activities/test-validity/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

describe('testValidityReviewImpl — language-aware test file detection', () => {
  it('recognizes Kotlin test files as test files', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, testValidity: { enabled: true, triggerAfterCycles: 1, model: 'claude-opus-4-6' } };
    const state = {
      ...createInitialState({ taskId: 'kv-1', description: 'Fix', mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['java'] }),
      verifierVerdict: {
        testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const,
        testFailures: [{ testName: 'userTest', message: 'assertion failed', file: 'src/com/example/UserServiceTest.kt' }],
        blockedByCritic: false, confidenceScore: 0.3,
      },
      correctionCycle: { attemptCount: 2, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
      debugObservations: { prunedStack: [] },
    };

    // Mock the extractor to return TEST_FAULT so we can verify the file was recognized
    deps.extractor = {
      extract: async (_prompt: string, schema: import('zod').ZodType) => {
        return schema.parse({ verdict: 'TEST_FAULT', confidence: 0.9, affectedTests: ['UserServiceTest.kt'], proposedFixes: [] });
      },
    } as never;

    const result = await testValidityReviewImpl(state as never, deps);

    // If Kotlin test file was recognized, the state should have testValidityFlag set
    expect(result.testValidityFlag).toBeDefined();
  });

  it('recognizes Go test files as test files', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, testValidity: { enabled: true, triggerAfterCycles: 1, model: 'claude-opus-4-6' } };
    const state = {
      ...createInitialState({ taskId: 'go-1', description: 'Fix', mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['go'] }),
      verifierVerdict: {
        testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const,
        testFailures: [{ testName: 'handlerTest', message: 'nil pointer', file: 'src/handler/handler_test.go' }],
        blockedByCritic: false, confidenceScore: 0.3,
      },
      correctionCycle: { attemptCount: 2, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
      debugObservations: { prunedStack: [] },
    };

    deps.extractor = {
      extract: async (_prompt: string, schema: import('zod').ZodType) => {
        return schema.parse({ verdict: 'TEST_FAULT', confidence: 0.9, affectedTests: ['handler_test.go'], proposedFixes: [] });
      },
    } as never;

    const result = await testValidityReviewImpl(state as never, deps);

    expect(result.testValidityFlag).toBeDefined();
  });

  it('recognizes Python test files as test files', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, testValidity: { enabled: true, triggerAfterCycles: 1, model: 'claude-opus-4-6' } };
    const state = {
      ...createInitialState({ taskId: 'py-1', description: 'Fix', mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['python'] }),
      verifierVerdict: {
        testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const,
        testFailures: [{ testName: 'test_user', message: 'assertion failed', file: 'src/tests/test_user.py' }],
        blockedByCritic: false, confidenceScore: 0.3,
      },
      correctionCycle: { attemptCount: 2, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
      debugObservations: { prunedStack: [] },
    };

    deps.extractor = {
      extract: async (_prompt: string, schema: import('zod').ZodType) => {
        return schema.parse({ verdict: 'TEST_FAULT', confidence: 0.9, affectedTests: ['test_user.py'], proposedFixes: [] });
      },
    } as never;

    const result = await testValidityReviewImpl(state as never, deps);

    expect(result.testValidityFlag).toBeDefined();
  });
});
