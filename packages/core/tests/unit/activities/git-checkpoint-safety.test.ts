import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { gitCheckpointImpl } from '../../../src/activities/git-checkpoint/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

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

function makeState(taskId: string, filePath: string, description = 'Normal task') {
  return {
    ...createInitialState({
      taskId, description,
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

describe('gitCheckpointImpl - no shell injection', () => {
  it('does not execute shell commands in file paths', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tacv-git-test-'));
    const injection = '$(touch ' + INJECTED_MARKER + ')';

    initGitRepo(tmpDir);
    const deps = makeDeps(tmpDir);
    const state = makeState('shell-safe', 'src/test' + injection + '.ts');

    await gitCheckpointImpl(state, deps);

    expect(existsSync(INJECTED_MARKER)).toBe(false);
  });

  it('does not execute shell commands in branch names', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tacv-git-test-'));
    const injection = '$(touch ' + INJECTED_MARKER + ')';

    initGitRepo(tmpDir);
    const deps = makeDeps(tmpDir);
    const state = {
      ...makeState('shell' + injection, 'src/Main.ts'),
      task: { ...makeState('shell' + injection, 'src/Main.ts').task, taskId: 'shell' + injection },
    };

    await gitCheckpointImpl(state, deps);

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

    expect(existsSync(INJECTED_MARKER)).toBe(false);
  });

  it('commits successfully with a normal file path', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tacv-git-test-'));

    initGitRepo(tmpDir);
    // Create the file that the diff proposal references so git add can find it
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'CleanFile.ts'), 'export const x = 1;');

    const deps = makeDeps(tmpDir);
    const state = makeState('commit-test', 'src/CleanFile.ts');

    const result = await gitCheckpointImpl(state, deps);

    expect(result.gitCheckpoint?.commitHash).toBeDefined();
    expect(result.gitCheckpoint?.commitHash).toHaveLength(40);
    expect(result.gitCheckpoint?.branch).toMatch(/^tacv\/commit-test/);
    expect(result.gitCheckpoint?.changedFiles).toContain('src/CleanFile.ts');
  });

  it('handles author name with spaces via proper argument arrays', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tacv-git-test-'));

    initGitRepo(tmpDir);
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'Main.ts'), 'export const y = 2;');

    const deps = makeStubDeps();
    deps.repoPath = tmpDir;
    deps.config = {
      ...deps.config,
      gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'TACV Bot, Auto', authorEmail: 'bot@test' },
    };
    const state = makeState('space-author', 'src/Main.ts');

    const result = await gitCheckpointImpl(state, deps);

    expect(result.gitCheckpoint?.commitHash).toBeDefined();
  });
});
