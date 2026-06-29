import { describe, it, expect, vi } from 'vitest';
import { preflightImpl } from '../../../src/activities/preflight/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = {
  taskId: 'f3-1', description: 'Add auth endpoint',
  mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['typescript'],
};

function withDiff() {
  return {
    ...createInitialState(task),
    diffProposal: {
      diffs: [
        { filePath: 'src/auth.ts', operation: 'create' as const, diffContent: '// auth', language: 'typescript' },
      ],
      summary: 'add auth', testFilePaths: [],
    },
  };
}

describe('preflightImpl — diff reconciliation (F3)', () => {
  it('augments diffProposal with unreported filesystem changes', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };

    deps.gitExecutor = async (args: string[], _cwd: string) => {
      // git diff --name-only HEAD => args = ['diff', '--name-only', 'HEAD']
      if (args[0] === 'diff' && args[1] === '--name-only') {
        return 'src/auth.ts\nsrc/utils.ts\n';
      }
      // git diff HEAD -- <file> => args = ['diff', 'HEAD', '--', '<file>']
      return `// diff for ${args[3]}\n`;
    };

    const state = withDiff();
    const result = await preflightImpl(state, deps);

    expect(result.diffProposal).not.toBeNull();
    const augmentedFiles = result.diffProposal!.diffs.map((d: { filePath: string }) => d.filePath);
    expect(augmentedFiles).toContain('src/utils.ts');
  });

  it('does not augment when all files are already reported', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };

    deps.gitExecutor = async (args: string[], _cwd: string) => {
      if (args[0] === 'diff' && args[1] === '--name-only') {
        return 'src/auth.ts\n';
      }
      return '';
    };

    const state = withDiff();
    const result = await preflightImpl(state, deps);

    expect(result.diffProposal!.diffs).toHaveLength(1);
  });

  it('does not attempt reconciliation when git checkpoint is disabled', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: false, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };

    const state = withDiff();
    const result = await preflightImpl(state, deps);

    expect(result.currentPhase).toBe('CRITICS');
  });

  it('handles git diff errors gracefully', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };

    deps.gitExecutor = async () => { throw new Error('git not found'); };

    const state = withDiff();
    const result = await preflightImpl(state, deps);

    expect(result.currentPhase).toBe('CRITICS');
  });
});
