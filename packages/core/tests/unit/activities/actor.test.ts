import { describe, it, expect, vi } from 'vitest';
import { actorImpl } from '../../../src/activities/actor/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = { taskId: 'a1', description: 'Add user endpoint', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('actorImpl', () => {
  it('transitions to PREFLIGHT phase', async () => {
    const state = createInitialState(task);
    const result = await actorImpl(state, makeStubDeps());
    expect(result.currentPhase).toBe('PREFLIGHT');
  });

  it('increments attempt count', async () => {
    const state = createInitialState(task);
    const result = await actorImpl(state, makeStubDeps());
    expect(result.correctionCycle.attemptCount).toBe(1);
  });

  it('accumulates cost from agent call', async () => {
    const state = createInitialState(task);
    const result = await actorImpl(state, makeStubDeps());
    expect(result.cumulativeCostUsd).toBeGreaterThan(0);
  });

  it('adds audit entry', async () => {
    const state = createInitialState(task);
    const result = await actorImpl(state, makeStubDeps());
    expect(result.workflowAuditTrail.some(e => e.node === 'actor')).toBe(true);
  });

  it('injects critic feedback into prompt when findings present', async () => {
    let capturedPrompt = '';
    const deps = makeStubDeps();
    deps.agent = {
      runTask: async (prompt: string) => {
        capturedPrompt = prompt;
        return { content: '```json\n{"diffs":[],"summary":"fixed","testFilePaths":[]}\n```', toolCalls: [], finishReason: 'end_turn', inputTokens: 100, outputTokens: 50, totalCostUsd: 0.001, callCostUsd: 0.001 };
      },
    };
    const state = {
      ...createInitialState(task),
      criticFindings: [{ critic: 'security' as const, severity: 'critical' as const, file: 'src/Api.ts', line: 5, ruleId: 'NO_EVAL', message: 'eval usage', resolutionHint: 'remove eval' }],
    };
    await actorImpl(state as never, deps);
    expect(capturedPrompt).toContain('Critical Issues');
    expect(capturedPrompt).toContain('NO_EVAL');
  });
});
