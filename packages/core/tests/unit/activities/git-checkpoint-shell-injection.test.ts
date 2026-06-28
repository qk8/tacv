import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { gitCheckpointImpl } from '../../../src/activities/git-checkpoint/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

// Behavioral test: set up a real git repo and attempt shell injection.
// The vulnerability is in runGit() which uses exec() with string interpolation.
// When file paths or branch names contain $(), the shell executes them.
// Fix: use execFile (no shell) with array arguments.

const INJECTED_MARKER = join(tmpdir(), 'tacv_injected_shell_test');

beforeAll(() => { if (existsSync(INJECTED_MARKER)) rmSync(INJECTED_MARKER); });
afterAll(()  => { if (existsSync(INJECTED_MARKER)) rmSync(INJECTED_MARKER); });

function initGitRepo(dir: string) {
  execSync('git init -b main', { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# Test');
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "initial"', { cwd: dir });
}

function makeDeps(tmpDir: string) {
  const deps = makeStubDeps();
  deps.repoPath = tmpDir;
  deps.config = {
    ...deps.config,
    gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'TACV Bot', authorEmail: 'bot@test' },
  };
  return deps;
}

function makeState(taskId: string, filePath: string) {
  return {
    ...createInitialState({
      taskId, description: 'Normal task',
      mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['typescript'],
    }),
    diffProposal: {
      diffs: [{ filePath, operation: 'modify', diffContent: '+ hello', language: 'typescript' }],
      summary: 'add hello',
      testFilePaths: [],
    },
    correctionCycle: {
      attemptCount: 1, branchName: null, lastErrorHash: null,
      errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null,
    },
  };
}

describe('gitCheckpointImpl shell injection prevention', () => {
  it('does not execute shell commands in file paths via git add', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tacv-git-test-'));
    const injection = '$(touch ' + INJECTED_MARKER + ')';

    initGitRepo(tmpDir);
    const deps = makeDeps(tmpDir);
    const state = makeState('shell-1', `src/test${injection}.ts`);

    await gitCheckpointImpl(state, deps);

    // Vulnerable code: git add "src/test$(touch ...).ts" → shell executes touch
    // Fixed code: execFile('git', ['add', 'src/test$(touch ...).ts']) → no shell
    expect(existsSync(INJECTED_MARKER)).toBe(false);
  });

  it('does not execute shell commands in branch names via git checkout', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tacv-git-test-'));
    const injection = '$(touch ' + INJECTED_MARKER + ')';

    initGitRepo(tmpDir);
    const deps = makeDeps(tmpDir);
    // Inject into taskId which becomes part of the branch name
    const state = {
      ...makeState('shell' + injection, 'src/Main.ts'),
      task: { ...makeState('shell' + injection, 'src/Main.ts').task, taskId: 'shell' + injection },
    };

    await gitCheckpointImpl(state, deps);

    // Vulnerable code: git checkout -B tacv/shell$(touch ...) → shell executes touch
    // Fixed code: execFile('git', ['checkout', '-B', 'tacv/shell$(touch ...)']) → no shell
    expect(existsSync(INJECTED_MARKER)).toBe(false);
  });

  it('does not execute shell commands in commit messages', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tacv-git-test-'));
    const injection = '$(touch ' + INJECTED_MARKER + ')';

    initGitRepo(tmpDir);
    const deps = makeDeps(tmpDir);
    const state = {
      ...makeState('shell-safe', 'src/Main.ts'),
      task: { ...makeState('shell-safe', 'src/Main.ts').task, description: 'Add ' + injection + ' feature' },
    };

    await gitCheckpointImpl(state, deps);

    // Vulnerable code: commit -m "tacv(cycle-1): Add $(touch ...) feature" → shell executes touch
    // Fixed code: execFile('git', ['-c', 'user.name=...', 'commit', '-m', '...']) → no shell
    expect(existsSync(INJECTED_MARKER)).toBe(false);
  });
});
