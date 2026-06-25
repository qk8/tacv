import { describe, it, expect, vi } from 'vitest';
import { testValidityReviewImpl } from '../../../../src/activities/test-validity/impl.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'tv1', description: 'Add findById', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

function stateWithFailure(message: string, file = 'src/UserService.test.ts') {
  return {
    ...createInitialState(task),
    correctionCycle: { attemptCount: 2, branchName: 'main', lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
    verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_TEST' as const, testFailures: [{ testName: 'findById test', message, file }], blockedByCritic: false, confidenceScore: 0.7 },
  };
}

describe('testValidityReviewImpl', () => {
  it('skips when testValidity.enabled is false', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, testValidity: { enabled: false, triggerAfterCycles: 2, model: 'claude-opus-4-6' } };
    const result = await testValidityReviewImpl(stateWithFailure('test failed') as never, deps);
    expect(result.currentPhase).toBe('ACTOR');
  });

  it('returns ACTOR when verdict is IMPLEMENTATION_FAULT', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, testValidity: { enabled: true, triggerAfterCycles: 2, model: 'claude-opus-4-6' } };
    deps.extractor = { extract: vi.fn().mockResolvedValue({ verdict: 'IMPLEMENTATION_FAULT', affectedTests: [], proposedFixes: [], confidence: 0.9, reasoning: 'The implementation has a bug' }) };
    const result = await testValidityReviewImpl(stateWithFailure('expected null, got User{}') as never, deps);
    expect(result.currentPhase).toBe('ACTOR');
    expect(result.testValidityFlag).toBeNull();
  });

  it('escalates to HITL when TEST_FAULT detected with high confidence', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, testValidity: { enabled: true, triggerAfterCycles: 2, model: 'claude-opus-4-6' } };
    deps.extractor = { extract: vi.fn().mockResolvedValue({ verdict: 'TEST_FAULT', affectedTests: ['findById test'], proposedFixes: [{ testFile: 'src/UserService.test.ts', currentAssertion: 'expect(result).toBeNull()', suggestedFix: 'expect(result).toMatchObject({id: 1})', justification: 'Assertion is inverted' }], confidence: 0.9, reasoning: 'Test expects null but task says return user' }) };
    const result = await testValidityReviewImpl(stateWithFailure('expected null, got User{id:1}') as never, deps);
    expect(result.currentPhase).toBe('HITL_ESCALATION');
    expect(result.testValidityFlag?.suspected).toBe(true);
    expect(result.testValidityFlag?.proposedFixes).toHaveLength(1);
    expect(result.testValidityFlag?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('does not escalate when TEST_FAULT confidence is low', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, testValidity: { enabled: true, triggerAfterCycles: 2, model: 'claude-opus-4-6' } };
    deps.extractor = { extract: vi.fn().mockResolvedValue({ verdict: 'TEST_FAULT', affectedTests: ['test'], proposedFixes: [], confidence: 0.5, reasoning: 'Not sure' }) };
    const result = await testValidityReviewImpl(stateWithFailure('some failure') as never, deps);
    expect(result.currentPhase).toBe('ACTOR');  // low confidence → don't escalate
  });

  it('handles no verifier verdict gracefully', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, testValidity: { enabled: true, triggerAfterCycles: 2, model: 'claude-opus-4-6' } };
    const state = createInitialState(task);
    const result = await testValidityReviewImpl(state as never, deps);
    expect(result.currentPhase).toBe('ACTOR');
  });
});
