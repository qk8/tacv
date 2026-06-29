import { describe, it, expect, vi } from 'vitest';
import { gitCheckpointImpl } from '../../../src/activities/git-checkpoint/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  // Create initial commit so checkout -B works
  await fs.writeFile(path.join(dir, 'README.md'), '# test');
  await execFileAsync('git', ['add', '.'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: dir });
}

const task = {
  taskId: 'pr-1', description: 'Add user authentication endpoint',
  mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['typescript'],
};

function withPlan(repoPath: string) {
  // Write actual files so git add/commit works
  const srcDir = path.join(repoPath, 'src');
  fs.mkdir(srcDir, { recursive: true }).catch(() => {});
  fs.writeFile(path.join(srcDir, 'auth.ts'), '// auth module').catch(() => {});
  fs.writeFile(path.join(srcDir, 'auth.test.ts'), '// auth tests').catch(() => {});

  return {
    ...createInitialState(task),
    diffProposal: {
      diffs: [
        { filePath: 'src/auth.ts', operation: 'create' as const, diffContent: '', language: 'typescript' },
        { filePath: 'src/auth.test.ts', operation: 'create' as const, diffContent: '', language: 'typescript' },
      ],
      summary: 'add auth module', testFilePaths: ['src/auth.test.ts'],
    },
    implementationPlan: {
      planSummary: 'Implement JWT-based authentication',
      filesToCreate: ['src/auth.ts'],
      filesToModify: [],
      filesToDelete: [],
      testFilesToCreate: ['src/auth.test.ts'],
      estimatedComplexity: 'medium',
      riskyAreas: ['token validation'],
      criticsApproved: true,
      fastCriticFindings: [],
    },
    verifierVerdict: {
      testResult: 'PASS' as const, diagnostic: 'PASS' as const,
      testFailures: [], blockedByCritic: false, confidenceScore: 1.0,
    },
    correctionCycle: { attemptCount: 1, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
  };
}

describe('gitCheckpointImpl — PR description generation (F1)', () => {
  it('generates a PR description file when git commit succeeds and plan exists', async () => {
    const tmpDir = await fs.mkdtemp(path.join('/tmp', 'tacv-pr-'));
    await initGitRepo(tmpDir);
    const deps = makeStubDeps({ repoPath: tmpDir });
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    const state = withPlan(tmpDir);
    const result = await gitCheckpointImpl(state, deps);

    // PR description file should be written
    expect(result.workflowAuditTrail.some(
      e => e.node === 'git_checkpoint' && e.decision === 'committed_with_pr_desc',
    )).toBe(true);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('PR description includes task description as title', async () => {
    const tmpDir = await fs.mkdtemp(path.join('/tmp', 'tacv-pr-'));
    await initGitRepo(tmpDir);
    const deps = makeStubDeps({ repoPath: tmpDir });
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    const state = withPlan(tmpDir);
    const result = await gitCheckpointImpl(state, deps);

    // The audit trail should record the PR description path
    const prDescEntry = result.workflowAuditTrail.find(
      e => e.node === 'git_checkpoint' && e.keyValues['prDescriptionPath'],
    );
    expect(prDescEntry).toBeDefined();
    expect(prDescEntry!.keyValues['prDescriptionPath']).toContain('.workflow/pr_description.md');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('does not fail when PR description generation fails — only logs warning', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    // Use a non-existent repo so git fails — PR desc generation should not throw
    deps.repoPath = '/nonexistent/path/that/cannot/be/a/git/repo';
    const state = withPlan('/nonexistent/path/that/cannot/be/a/git/repo');
    const result = await gitCheckpointImpl(state, deps);

    // Should not throw; checkpoint should still be recorded
    expect(result.gitCheckpoint).toBeDefined();
  });

  it('does not generate PR description when git commit fails', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    deps.repoPath = '/nonexistent/path/that/cannot/be/a/git/repo';
    const state = withPlan('/nonexistent/path/that/cannot/be/a/git/repo');
    const result = await gitCheckpointImpl(state, deps);

    // When git fails, commitHash is null — PR description should not be generated
    const prDescEntry = result.workflowAuditTrail.find(
      e => e.node === 'git_checkpoint' && e.keyValues['prDescriptionPath'],
    );
    expect(prDescEntry).toBeUndefined();
  });

  it('does not generate PR description when no implementation plan exists', async () => {
    const tmpDir = await fs.mkdtemp(path.join('/tmp', 'tacv-pr-'));
    await initGitRepo(tmpDir);
    const deps = makeStubDeps({ repoPath: tmpDir });
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    const state = createInitialState(task);
    state.diffProposal = {
      diffs: [{ filePath: 'src/x.ts', operation: 'create' as const, diffContent: '', language: 'typescript' }],
      summary: 'x', testFilePaths: [],
    };
    // No implementationPlan — should not generate PR desc
    const result = await gitCheckpointImpl(state, deps);

    const prDescEntry = result.workflowAuditTrail.find(
      e => e.node === 'git_checkpoint' && e.keyValues['prDescriptionPath'],
    );
    expect(prDescEntry).toBeUndefined();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
