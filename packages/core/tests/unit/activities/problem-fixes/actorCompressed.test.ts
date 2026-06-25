import { describe, it, expect, vi } from 'vitest';
import { actorImpl } from '../../../../src/activities/actor/impl.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'ac1', description: 'Implement rate limiting at 100 req/min per user', mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('actorImpl — compressed context', () => {
  it('does not include historical failures from previous cycles in prompt', async () => {
    let capturedPrompt = '';
    const deps = makeStubDeps();
    deps.agent = {
      runTask: async (prompt: string) => {
        capturedPrompt = prompt;
        return { content: '', toolCalls: [], finishReason: 'end_turn', inputTokens: 50, outputTokens: 20, totalCostUsd: 0.001, callCostUsd: 0.001 };
      },
    };
    const state = {
      ...createInitialState(task),
      correctionCycle: { attemptCount: 3, branchName: 'main', lastErrorHash: null, errorHistory: ['hash1','hash2','hash3'], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ testName: 'current-test', message: 'Current failure message' }], blockedByCritic: false, confidenceScore: 0.6 },
    };
    await actorImpl(state as never, deps);
    // Should contain current failures
    expect(capturedPrompt).toContain('Current failure message');
    // Should NOT bloat prompt with all 3 historical errors as separate sections
    const attempt3Mentions = (capturedPrompt.match(/Attempt 3/g) ?? []).length;
    expect(attempt3Mentions).toBeLessThanOrEqual(2); // mentioned once in header, not duplicated
  });

  it('includes scope violation warning for BROWNFIELD', async () => {
    let capturedPrompt = '';
    const deps = makeStubDeps();
    deps.agent = { runTask: async (p: string) => { capturedPrompt = p; return { content: '', toolCalls: [], finishReason: 'end_turn', inputTokens: 10, outputTokens: 5, totalCostUsd: 0.001, callCostUsd: 0.001 }; } };
    const state = {
      ...createInitialState(task),
      scopeViolations: [{ file: 'src/EmailService.ts', reason: 'Not related to rate limiting' }],
    };
    await actorImpl(state as never, deps);
    expect(capturedPrompt).toContain('Scope Warning');
    expect(capturedPrompt).toContain('EmailService.ts');
  });

  it('includes stagnation warning when pattern detected', async () => {
    let capturedPrompt = '';
    const deps = makeStubDeps();
    deps.agent = { runTask: async (p: string) => { capturedPrompt = p; return { content: '', toolCalls: [], finishReason: 'end_turn', inputTokens: 10, outputTokens: 5, totalCostUsd: 0.001, callCostUsd: 0.001 }; } };
    const state = {
      ...createInitialState(task),
      correctionCycle: { attemptCount: 3, branchName: 'main', lastErrorHash: 'abc', errorHistory: [], stagnationPattern: 'iteration' as const, lastOutcomeSignature: 'abc' },
    };
    await actorImpl(state as never, deps);
    expect(capturedPrompt).toContain('Stagnation Detected');
    expect(capturedPrompt).toContain('completely different approach');
  });

  it('includes diversity hint from selected strategy', async () => {
    let capturedPrompt = '';
    const deps = makeStubDeps();
    deps.agent = { runTask: async (p: string) => { capturedPrompt = p; return { content: '', toolCalls: [], finishReason: 'end_turn', inputTokens: 10, outputTokens: 5, totalCostUsd: 0.001, callCostUsd: 0.001 }; } };
    const state = {
      ...createInitialState(task),
      selectedStrategy: { strategyId: 's2', description: 'Use Redis', compositeScore: 0.7, estimatedRisk: 'medium' as const, affectedFiles: [], avoidHint: 'Do NOT use in-memory approaches (already tried)' },
    };
    await actorImpl(state as never, deps);
    expect(capturedPrompt).toContain('Do NOT use in-memory approaches');
  });

  it('only includes critical critic findings (not warnings) to reduce noise', async () => {
    let capturedPrompt = '';
    const deps = makeStubDeps();
    deps.agent = { runTask: async (p: string) => { capturedPrompt = p; return { content: '', toolCalls: [], finishReason: 'end_turn', inputTokens: 10, outputTokens: 5, totalCostUsd: 0.001, callCostUsd: 0.001 }; } };
    const state = {
      ...createInitialState(task),
      criticFindings: [
        { critic: 'security' as const, severity: 'critical' as const, file: 'src/A.ts', line: 1, ruleId: 'CRITICAL_RULE', message: 'Critical security issue', resolutionHint: 'Fix it' },
        { critic: 'style' as const, severity: 'warning' as const, file: 'src/B.ts', line: 2, ruleId: 'STYLE_RULE', message: 'Minor style issue', resolutionHint: 'Fix style' },
      ],
    };
    await actorImpl(state as never, deps);
    expect(capturedPrompt).toContain('CRITICAL_RULE');
    expect(capturedPrompt).not.toContain('STYLE_RULE'); // warnings filtered out
  });

  it('increments attempt count', async () => {
    const deps = makeStubDeps();
    const state = createInitialState(task);
    const result = await actorImpl(state, deps);
    expect(result.correctionCycle.attemptCount).toBe(1);
  });
});
