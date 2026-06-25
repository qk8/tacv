import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryConsolidationImpl } from '../../../src/activities/memory/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

const task = { taskId: 'm1', description: 'Add caching layer', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['java'] };

describe('memoryConsolidationImpl', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it('transitions to COMPLETE phase', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: async () => ({ outcomeSummary: 'Added caching', keyDecisions: ['Used Redis'], commonMistakes: [], archDecisions: [], testsAdded: [], succeededVia: 'direct' }) };
    deps.memory = { ...deps.memory, add: vi.fn().mockResolvedValue('id1'), getAll: vi.fn().mockResolvedValue([{ id: 'n1', text: 'noise', metadata: { type: 'episodic', subtype: 'attempt' } }]), delete: vi.fn().mockResolvedValue(undefined), deleteAll: vi.fn().mockResolvedValue(undefined), search: vi.fn().mockResolvedValue([]) };
    const state = createInitialState(task);
    const result = await memoryConsolidationImpl(state, deps);
    expect(result.currentPhase).toBe('COMPLETE');
    expect(result.lessonLearned?.taskId).toBe('m1');
    expect(result.lessonLearned?.succeededVia).toBe('direct');
  });

  it('persists lesson to memory store', async () => {
    const addSpy = vi.fn().mockResolvedValue('id1');
    const deps = makeStubDeps();
    deps.extractor = { extract: async () => ({ outcomeSummary: 'done', keyDecisions: [], commonMistakes: [], archDecisions: [], testsAdded: [], succeededVia: 'direct' }) };
    deps.memory = { ...deps.memory, add: addSpy, getAll: vi.fn().mockResolvedValue([]), delete: vi.fn(), deleteAll: vi.fn() };
    const state = createInitialState(task);
    await memoryConsolidationImpl(state, deps);
    expect(addSpy).toHaveBeenCalledWith(expect.stringContaining('lesson_learned'), expect.any(String), expect.any(String), expect.any(Object));
  });

  it('handles missing AGENTS.md gracefully', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: async () => ({ outcomeSummary: 'done', keyDecisions: ['decision1'], commonMistakes: [], archDecisions: [], testsAdded: [], succeededVia: 'direct' }) };
    deps.memory = { ...deps.memory, add: vi.fn().mockResolvedValue('id1'), getAll: vi.fn().mockResolvedValue([]), delete: vi.fn(), deleteAll: vi.fn() };
    const state = createInitialState(task);
    // Should not throw even when AGENTS.md is missing
    await expect(memoryConsolidationImpl(state, deps)).resolves.not.toThrow();
  });

  it('purges session noise from memory', async () => {
    const deleteSpy = vi.fn().mockResolvedValue(undefined);
    const deps = makeStubDeps();
    deps.extractor = { extract: async () => ({ outcomeSummary: 'done', keyDecisions: [], commonMistakes: [], archDecisions: [], testsAdded: [], succeededVia: 'direct' }) };
    deps.memory = { ...deps.memory, add: vi.fn().mockResolvedValue('id1'), getAll: vi.fn().mockResolvedValue([{ id: 'n1', text: 'noise attempt', metadata: { type: 'episodic', subtype: 'attempt_outcome' } }, { id: 'l1', text: 'lesson', metadata: { type: 'episodic', subtype: 'lesson_learned' } }]), delete: deleteSpy, deleteAll: vi.fn() };
    const state = createInitialState(task);
    await memoryConsolidationImpl(state, deps);
    // Should delete the noise (n1) but keep lesson (l1)
    expect(deleteSpy).toHaveBeenCalledWith('n1');
    expect(deleteSpy).not.toHaveBeenCalledWith('l1');
  });
});
