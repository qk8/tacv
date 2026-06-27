import { describe, it, expect } from 'vitest';
import { verifierImpl } from '../../../../src/activities/verification/impl.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'vv1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };
const diff  = { diffs: [{ filePath: 'src/User.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'typescript' }], summary: 'test', testFilePaths: [] };

describe('verifierImpl (detailed)', () => {
  it('returns PASS when all checks succeed', async () => {
    const result = await verifierImpl({ ...createInitialState(task), diffProposal: diff } as never, makeStubDeps());
    expect(result.verifierVerdict?.testResult).toBe('PASS');
  });

  it('returns FAIL AMBIGUOUS on type error', async () => {
    const deps = makeStubDeps();
    const _savedPlugin1 = deps.pluginRegistry.get('ts');
    deps.pluginRegistry = { get: () => ({ ..._savedPlugin1, typeCheck: async () => ({ violations: [{ file: 'src/User.ts', line: 5, ruleId: 'TS2322', message: 'Type error', resolutionHint: 'fix' }] }) } as never), getForFile: () => null };
    const result = await verifierImpl({ ...createInitialState(task), diffProposal: diff } as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
    expect(result.verifierVerdict?.diagnostic).toBe('AMBIGUOUS');
  });

  it('returns FAIL FIX_IMPL when protection tests fail', async () => {
    const deps = makeStubDeps();
    const _savedPlugin2 = deps.pluginRegistry.get('ts');
    deps.pluginRegistry = { get: () => ({ ..._savedPlugin2, typeCheck: async () => ({ violations: [] }), runProtectionTests: async () => ({ passed: false, totalTests: 5, failedTests: 1, failures: [{ testName: 'T1', message: 'assertion failed' }], coverageReport: null, durationMs: 100 }) } as never), getForFile: () => null };
    const result = await verifierImpl({ ...createInitialState(task), diffProposal: diff } as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
    expect(result.verifierVerdict?.diagnostic).toBe('FIX_IMPL');
  });

  it('skips when already blocked by critic', async () => {
    const state = { ...createInitialState(task), diffProposal: diff, verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [], blockedByCritic: true, confidenceScore: 0.8 } };
    const result = await verifierImpl(state as never, makeStubDeps());
    expect(result.verifierVerdict?.blockedByCritic).toBe(true);
  });
});
