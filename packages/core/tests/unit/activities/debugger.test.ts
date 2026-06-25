import { describe, it, expect } from 'vitest';
import { debuggerImpl } from '../../../src/activities/debugger/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = { taskId: 'd1', description: 'Fix NPE in UserService', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['java'] };

describe('debuggerImpl', () => {
  it('returns state unchanged when no verifier verdict', async () => {
    const state = createInitialState(task);
    const result = await debuggerImpl(state, makeStubDeps());
    expect(result.debugObservations).toBeNull();
  });

  it('returns state unchanged on PASS verdict', async () => {
    const state = { ...createInitialState(task), verifierVerdict: { testResult: 'PASS' as const, diagnostic: 'PASS' as const, testFailures: [], blockedByCritic: false, confidenceScore: 1.0 } };
    const result = await debuggerImpl(state as never, makeStubDeps());
    expect(result.debugObservations).toBeNull();
  });

  it('classifies NullPointerException as NULL_REFERENCE', async () => {
    const state = { ...createInitialState(task), verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'AMBIGUOUS' as const, testFailures: [{ testName: 'UserServiceTest', message: 'java.lang.NullPointerException at UserService.java:45' }], blockedByCritic: false, confidenceScore: 0.5 } };
    const result = await debuggerImpl(state as never, makeStubDeps());
    expect(result.debugObservations?.errorType).toBe('NULL_REFERENCE');
  });

  it('classifies BeanCreationException correctly', async () => {
    const state = { ...createInitialState(task), verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'AMBIGUOUS' as const, testFailures: [{ testName: 'ContextTest', message: 'BeanCreationException: Error creating bean with name userService' }], blockedByCritic: false, confidenceScore: 0.5 } };
    const result = await debuggerImpl(state as never, makeStubDeps());
    expect(result.debugObservations?.errorType).toBe('BEAN_CREATION_ERROR');
  });

  it('classifies TS TypeError as NULL_REFERENCE', async () => {
    const tsTask = { ...task, languageIds: ['typescript'] };
    const state = { ...createInitialState(tsTask), verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'AMBIGUOUS' as const, testFailures: [{ message: "TypeError: Cannot read properties of undefined (reading 'id')" }], blockedByCritic: false, confidenceScore: 0.5 } };
    const result = await debuggerImpl(state as never, makeStubDeps());
    expect(result.debugObservations?.errorType).toBe('NULL_REFERENCE');
  });

  it('transitions to ACTOR phase and adds audit entry', async () => {
    const state = { ...createInitialState(task), verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'AMBIGUOUS' as const, testFailures: [{ message: 'NullPointerException at line 42' }], blockedByCritic: false, confidenceScore: 0.5 } };
    const result = await debuggerImpl(state as never, makeStubDeps());
    expect(result.currentPhase).toBe('ACTOR');
    expect(result.workflowAuditTrail.some(e => e.node === 'intelligent_debugger')).toBe(true);
  });

  it('synthesises a root cause via LLM', async () => {
    const state = { ...createInitialState(task), verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'AMBIGUOUS' as const, testFailures: [{ message: 'NullPointerException in UserService.findById at line 45' }], blockedByCritic: false, confidenceScore: 0.4 } };
    const deps = makeStubDeps();
    deps.agent = { runTask: async () => ({ content: 'The userId parameter is null when passed from the controller layer.', toolCalls: [], finishReason: 'end_turn', inputTokens: 50, outputTokens: 30, totalCostUsd: 0.001, callCostUsd: 0.001 }) };
    const result = await debuggerImpl(state as never, deps);
    expect(result.debugObservations?.rootCause).toContain('userId');
  });
});
