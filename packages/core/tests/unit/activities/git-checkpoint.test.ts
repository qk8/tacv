import { describe, it, expect, vi } from 'vitest';
import { gitCheckpointImpl } from '../../../src/activities/git-checkpoint/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = {
  taskId: 'git-1', description: 'Add feature',
  mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['typescript'],
};

const passedState = () => ({
  ...createInitialState(task),
  diffProposal: {
    diffs: [{ filePath: 'src/User.ts', operation: 'modify' as const, diffContent: '+ const x=1;', language: 'typescript' }],
    summary: 'add x', testFilePaths: [],
  },
  verifierVerdict: {
    testResult: 'PASS' as const, diagnostic: 'PASS' as const,
    testFailures: [], blockedByCritic: false, confidenceScore: 1.0,
  },
  correctionCycle: { attemptCount: 1, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
});

describe('gitCheckpointImpl', () => {
  it('returns state unchanged when disabled', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: false, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    const state  = passedState();
    const result = await gitCheckpointImpl(state, deps);
    expect(result.gitCheckpoint).toBeNull();
  });

  it('records which files were checkpointed from the diff proposal', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    const state  = passedState();
    // Mock exec to succeed
    const result = await gitCheckpointImpl(state, deps);
    expect(result.gitCheckpoint?.changedFiles).toContain('src/User.ts');
  });

  it('records the correct cycle number in the checkpoint', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    const state  = { ...passedState(), correctionCycle: { ...passedState().correctionCycle, attemptCount: 3 } };
    const result = await gitCheckpointImpl(state, deps);
    expect(result.gitCheckpoint?.cycleNumber).toBe(3);
  });

  it('sets branch name using taskId and branchPrefix', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    const result = await gitCheckpointImpl(passedState(), deps);
    expect(result.gitCheckpoint?.branch).toMatch(/^tacv\/git-1/);
  });

  it('does not throw when git command fails — returns null checkpoint gracefully', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    // Simulate git not available by using a non-existent repoPath
    deps.repoPath = '/nonexistent/path/that/cannot/be/a/git/repo';
    const result = await gitCheckpointImpl(passedState(), deps);
    // Should not throw; commitHash may be null on failure
    expect(result.gitCheckpoint).toBeDefined();
    // changedFiles should still be populated from the diff proposal
    expect(result.gitCheckpoint?.changedFiles).toContain('src/User.ts');
  });

  it('stores checkpoint timestamp close to now', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    const before = Date.now();
    const result = await gitCheckpointImpl(passedState(), deps);
    expect(result.gitCheckpoint?.checkpointAt).toBeGreaterThanOrEqual(before);
  });

  it('adds an audit trail entry', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, gitCheckpoint: { enabled: true, branchPrefix: 'tacv/', authorName: 'Bot', authorEmail: 'bot@test' } };
    const result = await gitCheckpointImpl(passedState(), deps);
    const entry = result.workflowAuditTrail.find(e => e.node === 'git_checkpoint');
    expect(entry).toBeDefined();
  });
});
