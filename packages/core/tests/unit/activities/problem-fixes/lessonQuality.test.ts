import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryConsolidationImpl } from '../../../../src/activities/memory/impl.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

const task = { taskId: 'lq1', description: 'Add caching', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('Lesson quality gate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it('persists clean lesson without flags', async () => {
    const addSpy = vi.fn().mockResolvedValue('id1');
    const deps = makeStubDeps();
    deps.extractor = {
      extract: vi.fn()
        .mockResolvedValueOnce({ outcomeSummary: 'Added Redis caching layer', keyDecisions: ['Used TTL=300s'], commonMistakes: [], archDecisions: [], testsAdded: [], succeededVia: 'direct' })
        .mockResolvedValueOnce({ safe: true, concerns: [] }),
    };
    deps.memory = { ...deps.memory, add: addSpy, getAll: vi.fn().mockResolvedValue([]), delete: vi.fn() };
    const result = await memoryConsolidationImpl(createInitialState(task), deps);
    expect(result.lessonLearned?.qualityFlags).toHaveLength(0);
    expect(result.lessonLearned?.outcomeSummary).not.toContain('FLAGGED');
  });

  it('flags lesson that mentions simplified tests', async () => {
    const addSpy = vi.fn().mockResolvedValue('id1');
    const deps = makeStubDeps();
    deps.extractor = {
      extract: vi.fn()
        .mockResolvedValueOnce({ outcomeSummary: 'Simplified test assertions to pass CI', keyDecisions: [], commonMistakes: [], archDecisions: [], testsAdded: [], succeededVia: 'direct' })
        .mockResolvedValueOnce({ safe: false, concerns: ['Lesson mentions simplified/removed assertions — likely a bad pattern'] }),
    };
    deps.memory = { ...deps.memory, add: addSpy, getAll: vi.fn().mockResolvedValue([]), delete: vi.fn() };
    const result = await memoryConsolidationImpl(createInitialState(task), deps);
    expect(result.lessonLearned?.qualityFlags.length).toBeGreaterThan(0);
    expect(result.lessonLearned?.outcomeSummary).toContain('FLAGGED FOR REVIEW');
    // Should still be persisted (with flag) — not silently dropped
    expect(addSpy).toHaveBeenCalled();
  });

  it('purges session noise but preserves lesson', async () => {
    const deleteSpy = vi.fn().mockResolvedValue(undefined);
    const deps = makeStubDeps();
    deps.extractor = {
      extract: vi.fn()
        .mockResolvedValueOnce({ outcomeSummary: 'Done', keyDecisions: [], commonMistakes: [], archDecisions: [], testsAdded: [], succeededVia: 'direct' })
        .mockResolvedValueOnce({ safe: true, concerns: [] }),
    };
    deps.memory = {
      ...deps.memory,
      add: vi.fn().mockResolvedValue('id1'),
      getAll: vi.fn().mockResolvedValue([
        { id: 'noise1', text: 'attempt 1 failed', metadata: { type: 'episodic', subtype: 'attempt_outcome' } },
        { id: 'noise2', text: 'attempt 2 failed', metadata: { type: 'episodic', subtype: 'attempt_outcome' } },
        { id: 'lesson1', text: '{"subtype":"lesson_learned"}', metadata: { type: 'episodic', subtype: 'lesson_learned' } },
      ]),
      delete: deleteSpy,
    };
    await memoryConsolidationImpl(createInitialState(task), deps);
    // noise deleted, lesson kept
    expect(deleteSpy).toHaveBeenCalledWith('noise1');
    expect(deleteSpy).toHaveBeenCalledWith('noise2');
    expect(deleteSpy).not.toHaveBeenCalledWith('lesson1');
  });
});
