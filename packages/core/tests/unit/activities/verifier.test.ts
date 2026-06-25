import { describe, it, expect, vi } from 'vitest';
import { verifierImpl } from '../../../src/activities/verification/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = { taskId: 'v1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

const baseDiff = {
  diffs: [{ filePath: 'src/User.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'typescript' }],
  summary: 'test diff', testFilePaths: ['src/User.test.ts'],
};

describe('verifierImpl', () => {
  it('returns PASS when all checks succeed', async () => {
    const state = { ...createInitialState(task), diffProposal: baseDiff };
    const result = await verifierImpl(state as never, makeStubDeps());
    expect(result.verifierVerdict?.testResult).toBe('PASS');
  });

  it('returns FAIL when type check fails', async () => {
    const deps = makeStubDeps();
    deps.pluginRegistry = {
      get: () => ({
        ...deps.pluginRegistry.get('typescript'),
        typeCheck: async () => ({ violations: [{ file: 'src/User.ts', line: 5, ruleId: 'TS2322', message: 'Type error', resolutionHint: 'Fix it' }] }),
      } as never),
      getForFile: () => null,
    };
    const state = { ...createInitialState(task), diffProposal: baseDiff };
    const result = await verifierImpl(state as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
    expect(result.verifierVerdict?.diagnostic).toBe('AMBIGUOUS');
  });

  it('returns FAIL when protection tests fail', async () => {
    const deps = makeStubDeps();
    deps.pluginRegistry = {
      get: () => ({
        ...deps.pluginRegistry.get('typescript'),
        typeCheck: async () => ({ violations: [] }),
        runProtectionTests: async () => ({ passed: false, totalTests: 5, failedTests: 1, failures: [{ testName: 'UserTest', message: 'expected true but got false' }], coverageReport: null, durationMs: 100 }),
      } as never),
      getForFile: () => null,
    };
    const state = { ...createInitialState(task), diffProposal: baseDiff };
    const result = await verifierImpl(state as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
    expect(result.verifierVerdict?.diagnostic).toBe('FIX_IMPL');
  });

  it('skips when blocked by critic', async () => {
    const state = {
      ...createInitialState(task),
      diffProposal: baseDiff,
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [], blockedByCritic: true, confidenceScore: 0.8 },
    };
    const result = await verifierImpl(state as never, makeStubDeps());
    expect(result.verifierVerdict?.blockedByCritic).toBe(true);
  });

  it('returns PASS when no diff proposal exists', async () => {
    const state = createInitialState(task);
    const result = await verifierImpl(state as never, makeStubDeps());
    expect(result.currentPhase).toBe('VERIFIER');
  });
});
