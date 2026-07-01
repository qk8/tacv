import { describe, it, expect } from 'vitest';
import { implementorImpl } from '../../../src/agents/implementor/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';
import type { TaskNode } from '../../../src/planning/graph.js';
import type { AgentConfig } from '../../../src/interfaces/IAgentProvider.js';
import type { DiffEntry } from '../../../src/state/schemas.js';

const task = { taskId: 'impl1', description: 'Add Redis caching layer', mode: 'BROWNFIELD' as const, moduleType: 'ts-backend', languageIds: ['typescript'] };

const node: TaskNode = {
  id: 'impl:src/cache/RedisCache.ts',
  description: 'Implement the Redis cache client wrapper',
  filesToTouch: ['src/cache/RedisCache.ts'],
  dependsOn: [],
  estimatedComplexity: 'medium',
  riskScore: 0.4,
};

const testFiles: DiffEntry[] = [
  { filePath: 'src/cache/RedisCache.test.ts', operation: 'create', diffContent: 'describe("RedisCache", () => { it("connects", () => {}) })', language: 'typescript' },
];

describe('implementorImpl', () => {
  it('returns the implementation diff(s) produced by the agent', async () => {
    const deps = makeStubDeps();
    deps.agent = {
      runTask: async () => ({
        content: '```json\n{"diffs":[{"filePath":"src/cache/RedisCache.ts","operation":"create","diffContent":"export class RedisCache {}","language":"typescript"}],"summary":"implemented"}\n```',
        toolCalls: [], finishReason: 'end_turn', inputTokens: 100, outputTokens: 50, totalCostUsd: 0.003, callCostUsd: 0.003,
      }),
    };
    const result = await implementorImpl(node, createInitialState(task), testFiles, deps);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0].filePath).toBe('src/cache/RedisCache.ts');
  });

  it('does not filter out implementation-file diffs (unlike the Test Writer, this role is allowed to write non-test files)', async () => {
    const deps = makeStubDeps();
    deps.agent = {
      runTask: async () => ({
        content: '```json\n{"diffs":[{"filePath":"src/cache/RedisCache.ts","operation":"create","diffContent":"x","language":"typescript"}],"summary":"x"}\n```',
        toolCalls: [], finishReason: 'end_turn', inputTokens: 1, outputTokens: 1, totalCostUsd: 0.001, callCostUsd: 0.001,
      }),
    };
    const result = await implementorImpl(node, createInitialState(task), testFiles, deps);
    expect(result.roleViolations).toEqual([]);
  });

  it('accumulates cost from the agent call', async () => {
    const deps = makeStubDeps();
    deps.agent = { runTask: async () => ({ content: '```json\n{"diffs":[],"summary":"x"}\n```', toolCalls: [], finishReason: 'end_turn', inputTokens: 1, outputTokens: 1, totalCostUsd: 0.004, callCostUsd: 0.004 }) };
    const result = await implementorImpl(node, createInitialState(task), testFiles, deps);
    expect(result.costUsd).toBeCloseTo(0.004, 5);
  });

  it('passes the test file content into the prompt so the implementor knows the contract it must satisfy', async () => {
    let capturedPrompt = '';
    let capturedConfig: AgentConfig | null = null;
    const deps = makeStubDeps();
    deps.agent = {
      runTask: async (prompt: string, _ctx: Record<string, unknown>, config: AgentConfig) => {
        capturedPrompt = prompt;
        capturedConfig = config;
        return { content: '```json\n{"diffs":[],"summary":"x"}\n```', toolCalls: [], finishReason: 'end_turn', inputTokens: 1, outputTokens: 1, totalCostUsd: 0, callCostUsd: 0 };
      },
    };
    await implementorImpl(node, createInitialState(task), testFiles, deps);
    expect(capturedPrompt).toContain('RedisCache.test.ts');
    expect(capturedPrompt).toContain('describe("RedisCache"');
    expect(capturedConfig?.role).toBe('implementor');
  });
});
