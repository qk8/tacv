import { describe, it, expect } from 'vitest';
import {
  buildTestWriterSystemPrompt, buildTestWriterUserPrompt,
  buildImplementorSystemPrompt, buildImplementorUserPrompt,
} from '../../../src/agents/contextBuilders.js';
import { buildCompressedActorPrompt } from '../../../src/activities/actor/impl.js';
import { createInitialState, type WorkflowState, type DiffEntry } from '../../../src/state/schemas.js';
import type { TaskNode } from '../../../src/planning/graph.js';

const task = { taskId: 'mt1', description: 'Add Redis caching layer', mode: 'BROWNFIELD' as const, moduleType: 'ts-backend', languageIds: ['typescript'] };

const node: TaskNode = {
  id: 'impl:src/cache/RedisCache.ts',
  description: 'Implement the Redis cache client wrapper',
  filesToTouch: ['src/cache/RedisCache.ts'],
  dependsOn: [],
  estimatedComplexity: 'medium',
  riskScore: 0.4,
};

function noisyState(): WorkflowState {
  const s = createInitialState(task);
  return {
    ...s,
    agentsMdContext: '## Testing Conventions\nUse AAA pattern. Co-locate test files.\n## Java\nUse ResponseEntity<T>.',
    sessionScratchpad: 'Cycle 1: tried approach Foo and it failed because of XYZUNRELATEDNOISE. Cycle 2: tried Bar, ABCUNRELATEDNOISE.',
    criticFindings: [
      { critic: 'security', severity: 'critical', file: 'src/cache/RedisCache.ts', line: 5, ruleId: 'IN_SCOPE_FINDING', message: 'In-scope finding text', resolutionHint: 'Fix the in-scope thing' },
      { critic: 'style', severity: 'warning', file: 'src/unrelated/OtherModule.ts', line: 1, ruleId: 'OUT_OF_SCOPE_FINDING', message: 'Out-of-scope finding text', resolutionHint: 'Fix the out-of-scope thing' },
    ],
    implementationPlan: {
      planSummary: 'Add Redis caching layer',
      filesToCreate: ['src/cache/RedisCache.ts', 'src/unrelated/OtherModule.ts', 'src/another/Thing.ts'],
      filesToModify: [], filesToDelete: [], testFilesToCreate: [],
      estimatedComplexity: 'medium', riskyAreas: [], criticsApproved: true, fastCriticFindings: [],
    },
    verifierVerdict: {
      testResult: 'FAIL', diagnostic: 'FIX_IMPL',
      testFailures: [{ message: 'NOISYUNRELATEDFAILURE in OtherModule' }],
      blockedByCritic: false, confidenceScore: 0.5,
    },
  };
}

describe('buildTestWriterSystemPrompt — role isolation', () => {
  it('instructs the agent to write tests only, not implementation code', () => {
    const prompt = buildTestWriterSystemPrompt();
    expect(prompt.toLowerCase()).toMatch(/test/);
    expect(prompt.toLowerCase()).toMatch(/do not (write|implement)|never implement|test.only/);
  });

  it('references the AAA (Arrange/Act/Assert) convention so generated tests match project style', () => {
    expect(buildTestWriterSystemPrompt().toLowerCase()).toMatch(/arrange.*act.*assert|aaa/);
  });
});

describe('buildTestWriterUserPrompt — narrow, single-node context', () => {
  it('includes this node\'s description and target files', () => {
    const prompt = buildTestWriterUserPrompt(node, noisyState());
    expect(prompt).toContain('Implement the Redis cache client wrapper');
    expect(prompt).toContain('src/cache/RedisCache.ts');
  });

  it('does NOT leak unrelated scratchpad noise from other cycles/nodes into this node\'s prompt', () => {
    const prompt = buildTestWriterUserPrompt(node, noisyState());
    expect(prompt).not.toContain('XYZUNRELATEDNOISE');
    expect(prompt).not.toContain('ABCUNRELATEDNOISE');
  });

  it('does NOT include the full implementation plan\'s unrelated file list', () => {
    const prompt = buildTestWriterUserPrompt(node, noisyState());
    expect(prompt).not.toContain('src/unrelated/OtherModule.ts');
    expect(prompt).not.toContain('src/another/Thing.ts');
  });
});

describe('buildImplementorSystemPrompt — role isolation', () => {
  it('instructs the agent to satisfy the given tests rather than write its own from scratch', () => {
    expect(buildImplementorSystemPrompt().toLowerCase()).toMatch(/satisfy|make.*pass|given test/);
  });
});

describe('buildImplementorUserPrompt — narrow, single-node context with test contract', () => {
  const testFiles: DiffEntry[] = [
    { filePath: 'src/cache/RedisCache.test.ts', operation: 'create', diffContent: 'describe("RedisCache", () => { it("connects", () => {}) })', language: 'typescript' },
  ];

  it('includes the test file content the implementation must satisfy', () => {
    const prompt = buildImplementorUserPrompt(node, noisyState(), testFiles);
    expect(prompt).toContain('RedisCache.test.ts');
    expect(prompt).toContain('describe("RedisCache"');
  });

  it('includes AGENTS.md project conventions', () => {
    const prompt = buildImplementorUserPrompt(node, noisyState(), testFiles);
    expect(prompt).toContain('AAA pattern');
  });

  it('includes critic findings SCOPED to this node\'s files only', () => {
    const prompt = buildImplementorUserPrompt(node, noisyState(), testFiles);
    expect(prompt).toContain('In-scope finding text');
  });

  it('EXCLUDES critic findings for files outside this node\'s scope (no cross-node noise)', () => {
    const prompt = buildImplementorUserPrompt(node, noisyState(), testFiles);
    expect(prompt).not.toContain('Out-of-scope finding text');
  });

  it('EXCLUDES unrelated verifier failure noise from other parts of the codebase', () => {
    const prompt = buildImplementorUserPrompt(node, noisyState(), testFiles);
    expect(prompt).not.toContain('NOISYUNRELATEDFAILURE');
  });

  it('produces a materially shorter prompt than the monolithic actor prompt for the same noisy state, despite carrying everything this node actually needs', () => {
    const narrow = buildImplementorUserPrompt(node, noisyState(), testFiles);
    const monolithic = buildCompressedActorPrompt(noisyState(), 6);
    expect(narrow.length).toBeLessThan(monolithic.length);
  });
});
