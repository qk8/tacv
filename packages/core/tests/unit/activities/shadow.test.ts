import { describe, it, expect, vi } from 'vitest';
import { pickRecentTaskForFuzz, persistShadowFindings } from '../../../src/activities/shadow/impl.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

describe('pickRecentTaskForFuzz', () => {
  it('returns empty when no lessons in memory', async () => {
    const deps = makeStubDeps();
    deps.memory = { ...deps.memory, search: vi.fn().mockResolvedValue([]) };
    const tasks = await pickRecentTaskForFuzz({ repoPath: '.', count: 3 }, deps);
    expect(tasks).toHaveLength(0);
  });

  it('parses valid lesson JSON from memory', async () => {
    const lesson = { taskId: 't1', taskDescription: 'Add user', repoPath: '/repo', moduleType: 'backend', languageIds: ['java'] };
    const deps = makeStubDeps();
    deps.memory = { ...deps.memory, search: vi.fn().mockResolvedValue([{ id: '1', text: JSON.stringify(lesson), metadata: {} }]) };
    const tasks = await pickRecentTaskForFuzz({ repoPath: '.', count: 3 }, deps);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.taskId).toBe('t1');
  });

  it('handles memory search failures gracefully', async () => {
    const deps = makeStubDeps();
    deps.memory = { ...deps.memory, search: vi.fn().mockRejectedValue(new Error('Memory unavailable')) };
    const tasks = await pickRecentTaskForFuzz({ repoPath: '.', count: 3 }, deps);
    expect(tasks).toHaveLength(0);
  });
});

describe('persistShadowFindings', () => {
  it('stores each finding in memory', async () => {
    const addSpy = vi.fn().mockResolvedValue('id1');
    const deps = makeStubDeps();
    deps.memory = { ...deps.memory, add: addSpy };
    await persistShadowFindings('task-1', [
      { description: 'N+1 query', file: 'UserRepo.java', severity: 'medium', source: 'fuzz' },
      { description: 'Unused import', file: 'Api.java', severity: 'low', source: 'refactor' },
    ], deps);
    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(addSpy.mock.calls[0]![0]).toContain('N+1 query');
  });

  it('is a no-op for empty findings', async () => {
    const addSpy = vi.fn();
    const deps = makeStubDeps();
    deps.memory = { ...deps.memory, add: addSpy };
    await persistShadowFindings('task-1', [], deps);
    expect(addSpy).not.toHaveBeenCalled();
  });
});
