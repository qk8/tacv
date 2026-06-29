import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryConsolidationImpl } from '../../../src/activities/memory/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

const task = { taskId: 'ams1', description: 'Manage AGENTS.md size', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('AGENTS.md size management', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it('appends without consolidation when file is under threshold', async () => {
    const smallContent = '# AGENTS.md\n\n## Session 2026-01-01 — Small task\n### Key Decisions\n- decision1\n';
    vi.mocked(fs.readFile).mockResolvedValue(smallContent);

    const deps = makeStubDeps();
    deps.extractor = { extract: async () => ({ outcomeSummary: 'done', keyDecisions: ['decision1'], commonMistakes: [], archDecisions: [], testsAdded: [], succeededVia: 'direct' }) };
    deps.memory = { ...deps.memory, add: vi.fn().mockResolvedValue('id1'), getAll: vi.fn().mockResolvedValue([]), delete: vi.fn(), deleteAll: vi.fn() };

    await memoryConsolidationImpl(createInitialState(task), deps);

    // Should append new content without consolidation (single write)
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const written = vi.mocked(fs.writeFile).mock.calls[0]?.[1] as string;
    expect(written).toContain('Small task');
    expect(written).toContain('decision1');
    expect(written).toContain('Manage AGENTS.md size');
  });

  it('consolidates old content when file exceeds threshold', async () => {
    // Build a file that exceeds the threshold (agentsMdMaxChars = 4000)
    const oldEntries = Array.from({ length: 50 }, (_, i) =>
      `## Session 2026-01-0${i % 10} — Old task ${i}\n### Key Decisions\n- old decision ${i}\n### Avoid These Mistakes\n- old mistake ${i}\n`,
    ).join('\n');
    const largeContent = `# AGENTS.md\n\n${oldEntries}`;
    expect(largeContent.length).toBeGreaterThan(4000);

    vi.mocked(fs.readFile).mockResolvedValue(largeContent);

    const deps = makeStubDeps();
    let extractCallCount = 0;
    deps.extractor = {
      extract: async (prompt: string, schema: unknown) => {
        extractCallCount++;
        if (extractCallCount === 1) {
          return { outcomeSummary: 'done', keyDecisions: ['new decision'], commonMistakes: [], archDecisions: [], testsAdded: [], succeededVia: 'direct' };
        }
        // Subsequent calls are LLM summarization — return a compact summary
        return { summary: '[Consolidated: 50 old sessions summarized]', decisions: [], mistakes: [] };
      },
    };
    deps.memory = { ...deps.memory, add: vi.fn().mockResolvedValue('id1'), getAll: vi.fn().mockResolvedValue([]), delete: vi.fn(), deleteAll: vi.fn() };

    await memoryConsolidationImpl(createInitialState(task), deps);

    // writeFile should have been called with consolidated content
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const written = vi.mocked(fs.writeFile).mock.calls[0]?.[1] as string;
    expect(written).toContain('# AGENTS.md');
    // Old verbose entries should NOT appear verbatim
    expect(written).not.toContain('old decision 0');
    // New session content should be present
    expect(written).toContain('Manage AGENTS.md size');
  });

  it('appends new content without consolidation when under threshold', async () => {
    const existingContent = '# AGENTS.md\n\n## Session 2026-01-01 — Previous task\n### Key Decisions\n- prior decision\n';
    vi.mocked(fs.readFile).mockResolvedValue(existingContent);

    const deps = makeStubDeps();
    deps.extractor = { extract: async () => ({ outcomeSummary: 'done', keyDecisions: ['new decision'], commonMistakes: ['avoid x'], archDecisions: [], testsAdded: [], succeededVia: 'direct' }) };
    deps.memory = { ...deps.memory, add: vi.fn().mockResolvedValue('id1'), getAll: vi.fn().mockResolvedValue([]), delete: vi.fn(), deleteAll: vi.fn() };

    await memoryConsolidationImpl(createInitialState(task), deps);

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const written = vi.mocked(fs.writeFile).mock.calls[0]?.[1] as string;
    expect(written).toContain('prior decision');
    expect(written).toContain('new decision');
    expect(written).toContain('avoid x');
  });

  it('handles consolidation failure gracefully by falling back to append', async () => {
    const largeContent = Array.from({ length: 50 }, (_, i) =>
      `## Session 2026-01-0${i % 10} — Old task ${i}\n### Key Decisions\n- old decision ${i}\n`,
    ).join('\n');
    vi.mocked(fs.readFile).mockResolvedValue(largeContent);

    const deps = makeStubDeps();
    let extractCallCount = 0;
    deps.extractor = {
      extract: async () => {
        extractCallCount++;
        if (extractCallCount === 1) {
          return { outcomeSummary: 'done', keyDecisions: ['new'], commonMistakes: [], archDecisions: [], testsAdded: [], succeededVia: 'direct' };
        }
        // Second call (summarization) throws — simulate LLM failure
        throw new Error('LLM service unavailable');
      },
    };
    deps.memory = { ...deps.memory, add: vi.fn().mockResolvedValue('id1'), getAll: vi.fn().mockResolvedValue([]), delete: vi.fn(), deleteAll: vi.fn() };

    // Should not throw — falls back to simple append
    await expect(memoryConsolidationImpl(createInitialState(task), deps)).resolves.not.toThrow();
  });
});
