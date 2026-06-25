import { describe, it, expect, vi } from 'vitest';
import { verifierImpl } from '../../../../src/activities/verification/impl.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'vfs1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };
const diff = { diffs: [{ filePath: 'src/User.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'ts' }], summary: 'test', testFilePaths: ['src/User.test.ts'] };

describe('verifierImpl — full suite enforcement', () => {
  it('runs full protection suite by default (incrementalTesting.enabled=false)', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, incrementalTesting: { enabled: false, fastFeedbackMode: false } };
    const selectSpy = vi.spyOn(deps.codeGraph, 'selectAffectedTests');
    const state = { ...createInitialState(task), diffProposal: diff };
    await verifierImpl(state as never, deps);
    // selectAffectedTests should NOT be called when incremental is disabled
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('uses incremental selection when explicitly opted-in', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, incrementalTesting: { enabled: true, fastFeedbackMode: true } };
    const selectSpy = vi.spyOn(deps.codeGraph, 'selectAffectedTests').mockResolvedValue(['src/User.test.ts']);
    const state = { ...createInitialState(task), diffProposal: diff };
    await verifierImpl(state as never, deps);
    expect(selectSpy).toHaveBeenCalled();
  });

  it('uses per-path mutation threshold for critical paths', async () => {
    const deps = makeStubDeps();
    deps.config = {
      ...deps.config,
      mutation: { enabled: true, minimumScore: 70, maxTestFiles: 10, timeoutSec: 120, overrides: [{ pattern: 'src/payments/', minimumScore: 95 }] },
    };
    let capturedTestFile = '';
    deps.pluginRegistry = {
      get: () => ({
        ...deps.pluginRegistry.get('typescript'),
        typeCheck: async () => ({ violations: [] }),
        runProtectionTests: async () => ({ passed: true, totalTests: 5, failedTests: 0, failures: [], coverageReport: null, durationMs: 50 }),
        runAcceptanceTests: async () => ({ passed: true, totalTests: 2, failedTests: 0, failures: [], coverageReport: null, durationMs: 50 }),
        runApiTests: async () => ({ passed: true, totalTests: 0, failedTests: 0, failures: [], durationMs: 0 }),
        runMutationTests: async (_r: string, files: string[]) => {
          capturedTestFile = files[0] ?? '';
          return { mutationScore: 80, totalMutants: 10, killedMutants: 8, survivedMutants: 2, weakTestFiles: [], durationMs: 100 };
        },
      } as never),
      getForFile: () => null,
    };
    // payments path → should use 95% threshold → 80% score should fail
    const paymentsState = { ...createInitialState(task), diffProposal: { ...diff, testFilePaths: ['src/payments/PaymentService.test.ts'] } };
    const result = await verifierImpl(paymentsState as never, deps);
    // Should FAIL because 80% < 95% threshold for payments
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
    expect(result.verifierVerdict?.diagnostic).toBe('FIX_TEST');
  });

  it('PASS when mutation score meets generic threshold', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, mutation: { enabled: true, minimumScore: 70, maxTestFiles: 10, timeoutSec: 120, overrides: [] } };
    deps.pluginRegistry = {
      get: () => ({
        ...deps.pluginRegistry.get('typescript'),
        typeCheck: async () => ({ violations: [] }),
        runProtectionTests: async () => ({ passed: true, totalTests: 5, failedTests: 0, failures: [], coverageReport: null, durationMs: 50 }),
        runAcceptanceTests: async () => ({ passed: true, totalTests: 2, failedTests: 0, failures: [], coverageReport: null, durationMs: 50 }),
        runApiTests: async () => ({ passed: true, totalTests: 0, failedTests: 0, failures: [], durationMs: 0 }),
        runMutationTests: async () => ({ mutationScore: 75, totalMutants: 20, killedMutants: 15, survivedMutants: 5, weakTestFiles: [], durationMs: 100 }),
      } as never),
      getForFile: () => null,
    };
    const result = await verifierImpl({ ...createInitialState(task), diffProposal: diff } as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('PASS');
  });
});
