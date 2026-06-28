import { describe, it, expect } from 'vitest';
import { scoutImpl } from '../../../src/activities/scout/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

/**
 * Issue 25: scoutImpl only retrieves lesson_learned memories.
 *
 * Shadow findings stored as { type: 'procedural', subtype: 'shadow_finding' }
 * are never retrieved during scout. Procedural memory (recurring patterns,
 * anti-patterns discovered autonomously) is built up but never used.
 *
 * The fix: search for multiple memory types and combine them.
 */

const task = { taskId: 'test', description: 'Add user authentication', mode: 'BROWNFIELD' as const, moduleType: 'ts-frontend', languageIds: ['typescript'] };

describe('Issue 25: scout searches multiple memory types', async () => {
  it('searches both episodic and procedural memories', async () => {
    const searchCalls: Array<{ filters?: Record<string, string> }> = [];

    const deps = makeStubDeps({
      memory: {
        add: async () => 'id-1',
        search: async (params: { filters?: Record<string, string> }) => {
          searchCalls.push(params);
          return [];
        },
        getAll: async () => [],
        delete: async () => undefined,
        deleteAll: async () => undefined,
      },
      extractor: {
        extract: async () => ({
          contextSkeleton: {},
          strategyCandidates: [{ strategyId: 's1', description: 'test', compositeScore: 0.8, estimatedRisk: 'low' as const, affectedFiles: [] }],
          gitBlameContext: null,
        }) as never,
      },
    });

    await scoutImpl(createInitialState(task), deps);

    // Should have made at least 2 search calls: one for episodic, one for procedural
    const episodicCalls = searchCalls.filter(c => c.filters?.type === 'episodic');
    const proceduralCalls = searchCalls.filter(c => c.filters?.type === 'procedural');

    expect(episodicCalls.length).toBeGreaterThanOrEqual(1);
    expect(proceduralCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('combines results from both memory types into context', async () => {
    let memoryContextProduced = '';
    const originalExtract = makeStubDeps().extractor.extract;

    const deps = makeStubDeps({
      memory: {
        add: async () => 'id-1',
        search: async () => [{ text: 'prior lesson text' } as never],
        getAll: async () => [],
        delete: async () => undefined,
        deleteAll: async () => undefined,
      },
      extractor: {
        extract: async (prompt: string, _schema: unknown) => {
          // Capture the prompt to check memory context is included
          memoryContextProduced = prompt;
          return {
            contextSkeleton: {},
            strategyCandidates: [{ strategyId: 's1', description: 'test', compositeScore: 0.8, estimatedRisk: 'low' as const, affectedFiles: [] }],
            gitBlameContext: null,
          } as never;
        },
      },
    });

    await scoutImpl(createInitialState(task), deps);

    // The prompt should include memory context
    expect(memoryContextProduced).toContain('Prior task lessons');
  });
});
