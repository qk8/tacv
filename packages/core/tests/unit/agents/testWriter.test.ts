import { describe, it, expect } from 'vitest';
import { testWriterImpl } from '../../../src/agents/testWriter/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';
import type { TaskNode } from '../../../src/planning/graph.js';
import type { AgentConfig } from '../../../src/interfaces/IAgentProvider.js';

const task = { taskId: 'tw1', description: 'Add Redis caching layer', mode: 'BROWNFIELD' as const, moduleType: 'ts-backend', languageIds: ['typescript'] };

const node: TaskNode = {
  id: 'test:src/cache/RedisCache.test.ts',
  description: 'Write tests for the Redis cache client wrapper',
  filesToTouch: ['src/cache/RedisCache.test.ts'],
  dependsOn: [],
  estimatedComplexity: 'low',
  riskScore: 0.2,
};

describe('testWriterImpl', () => {
  it('returns the test-file diff(s) produced by the agent', async () => {
    const deps = makeStubDeps();
    deps.agent = {
      runTask: async () => ({
        content: '```json\n{"diffs":[{"filePath":"src/cache/RedisCache.test.ts","operation":"create","diffContent":"describe(...)","language":"typescript"}],"summary":"added tests"}\n```',
        toolCalls: [], finishReason: 'end_turn', inputTokens: 100, outputTokens: 50, totalCostUsd: 0.002, callCostUsd: 0.002,
      }),
    };
    const result = await testWriterImpl(node, createInitialState(task), deps);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0].filePath).toBe('src/cache/RedisCache.test.ts');
  });

  it('accumulates cost from the agent call', async () => {
    const deps = makeStubDeps();
    deps.agent = {
      runTask: async () => ({
        content: '```json\n{"diffs":[],"summary":"x"}\n```',
        toolCalls: [], finishReason: 'end_turn', inputTokens: 10, outputTokens: 10, totalCostUsd: 0.0015, callCostUsd: 0.0015,
      }),
    };
    const result = await testWriterImpl(node, createInitialState(task), deps);
    expect(result.costUsd).toBeCloseTo(0.0015, 5);
  });

  it('sends the test-writer role and a prompt containing the node description to the agent provider (role isolation)', async () => {
    let capturedPrompt = '';
    let capturedConfig: AgentConfig | null = null;
    const deps = makeStubDeps();
    deps.agent = {
      runTask: async (prompt: string, _ctx: Record<string, unknown>, config: AgentConfig) => {
        capturedPrompt = prompt;
        capturedConfig = config;
        return { content: '```json\n{"diffs":[],"summary":"x"}\n```', toolCalls: [], finishReason: 'end_turn', inputTokens: 1, outputTokens: 1, totalCostUsd: 0.0001, callCostUsd: 0.0001 };
      },
    };
    await testWriterImpl(node, createInitialState(task), deps);
    expect(capturedPrompt).toContain('Write tests for the Redis cache client wrapper');
    expect(capturedConfig?.role).toBe('test_writer');
  });

  it('ENFORCES role isolation by filtering out any non-test-file diff the agent attempts to produce, and records the violation', async () => {
    const deps = makeStubDeps();
    deps.agent = {
      runTask: async () => ({
        content: '```json\n{"diffs":[' +
          '{"filePath":"src/cache/RedisCache.test.ts","operation":"create","diffContent":"describe(...)","language":"typescript"},' +
          '{"filePath":"src/cache/RedisCache.ts","operation":"create","diffContent":"export class RedisCache {}","language":"typescript"}' +
          '],"summary":"added tests and implementation"}\n```',
        toolCalls: [], finishReason: 'end_turn', inputTokens: 100, outputTokens: 50, totalCostUsd: 0.002, callCostUsd: 0.002,
      }),
    };
    const result = await testWriterImpl(node, createInitialState(task), deps);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0].filePath).toBe('src/cache/RedisCache.test.ts');
    expect(result.roleViolations.length).toBeGreaterThan(0);
    expect(result.roleViolations[0]).toContain('RedisCache.ts');
  });

  it('returns an empty diffs array (not a throw) when the agent response has no parseable diff block', async () => {
    const deps = makeStubDeps();
    deps.agent = { runTask: async () => ({ content: 'no json here', toolCalls: [], finishReason: 'end_turn', inputTokens: 1, outputTokens: 1, totalCostUsd: 0, callCostUsd: 0 }) };
    const result = await testWriterImpl(node, createInitialState(task), deps);
    expect(result.diffs).toEqual([]);
  });
});
