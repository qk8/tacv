import { describe, it, expect } from 'vitest';
import {
  verifierTypeCheckStage,
  verifierTestsStage,
  verifierApiStage,
  verifierMutationStage,
  verifierVisualStage,
  buildVerifierSharedContext,
} from '../../../../src/activities/verification/stages.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 's1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };
const diff  = {
  diffs: [{ filePath: 'src/User.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'typescript' }],
  summary: 's', testFilePaths: ['src/User.test.ts'],
};

const stateWithDiff = () => ({ ...createInitialState(task), diffProposal: diff });

describe('buildVerifierSharedContext', () => {
  it('returns the list of changed files from diff proposal', () => {
    const ctx = buildVerifierSharedContext(stateWithDiff() as never, makeStubDeps());
    expect(ctx.changedFiles).toContain('src/User.ts');
  });

  it('returns empty when no diff proposal', () => {
    const ctx = buildVerifierSharedContext(createInitialState(task) as never, makeStubDeps());
    expect(ctx.changedFiles).toHaveLength(0);
  });
});

describe('verifierTypeCheckStage', () => {
  it('returns PASS when typeCheck has no violations', async () => {
    const result = await verifierTypeCheckStage(stateWithDiff() as never, makeStubDeps());
    expect(result.verifierVerdict?.testResult).toBe('PASS');
    expect(result.verifierVerdict?.diagnostic).toBe('PASS');
  });

  it('returns FAIL with AMBIGUOUS diagnostic when typeCheck fails', async () => {
    const deps = makeStubDeps();
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({ ...orig, typeCheck: async () => ({ violations: [{ file: 'src/User.ts', line: 5, ruleId: 'TS2322', message: 'Type error', resolutionHint: 'fix it' }] }) } as never),
      getForFile: () => null,
    };
    const result = await verifierTypeCheckStage(stateWithDiff() as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
    expect(result.verifierVerdict?.diagnostic).toBe('AMBIGUOUS');
  });

  it('is a no-op when verifier already has a FAIL verdict from a previous stage', async () => {
    const state = {
      ...stateWithDiff(),
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ message: 'prior failure' }], blockedByCritic: false, confidenceScore: 0.8 },
    };
    const deps = makeStubDeps();
    let typeCheckCalled = false;
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({ ...orig, typeCheck: async () => { typeCheckCalled = true; return { violations: [] }; } } as never),
      getForFile: () => null,
    };
    await verifierTypeCheckStage(state as never, deps);
    expect(typeCheckCalled).toBe(false);
  });
});

describe('verifierTestsStage', () => {
  it('returns PASS when protection tests pass', async () => {
    const result = await verifierTestsStage(stateWithDiff() as never, makeStubDeps());
    expect(result.verifierVerdict?.testResult).toBe('PASS');
  });

  it('returns FAIL FIX_IMPL when protection tests fail', async () => {
    const deps = makeStubDeps();
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...orig,
        runProtectionTests: async () => ({ passed: false, totalTests: 3, failedTests: 1, failures: [{ testName: 'T1', message: 'assertion error' }], coverageReport: null, durationMs: 50 }),
      } as never),
      getForFile: () => null,
    };
    const result = await verifierTestsStage(stateWithDiff() as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
    expect(result.verifierVerdict?.diagnostic).toBe('FIX_IMPL');
  });

  it('returns FAIL FIX_TEST when acceptance tests fail', async () => {
    const deps = makeStubDeps();
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...orig,
        runAcceptanceTests: async () => ({ passed: false, totalTests: 1, failedTests: 1, failures: [{ testName: 'AccTest', message: 'wrong output' }], coverageReport: null, durationMs: 80 }),
      } as never),
      getForFile: () => null,
    };
    const result = await verifierTestsStage(stateWithDiff() as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
    expect(result.verifierVerdict?.diagnostic).toBe('FIX_TEST');
  });

  it('skips when previous stage already set FAIL', async () => {
    const state = {
      ...stateWithDiff(),
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'AMBIGUOUS' as const, testFailures: [], blockedByCritic: false, confidenceScore: 0.9 },
    };
    const result = await verifierTestsStage(state as never, makeStubDeps());
    expect(result.verifierVerdict?.diagnostic).toBe('AMBIGUOUS'); // unchanged
  });
});

describe('verifierApiStage', () => {
  it('skips for frontend modules', async () => {
    const state = { ...stateWithDiff(), task: { ...task, moduleType: 'frontend' } };
    const result = await verifierApiStage(state as never, makeStubDeps());
    expect(result.verifierVerdict?.testResult).toBe('PASS');
  });

  it('runs API tests for backend modules and passes', async () => {
    const state = { ...stateWithDiff(), task: { ...task, moduleType: 'backend' } };
    const result = await verifierApiStage(state as never, makeStubDeps());
    expect(result.verifierVerdict?.testResult).toBe('PASS');
  });

  it('returns FAIL when API tests fail', async () => {
    const deps = makeStubDeps();
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...orig,
        runApiTests: async () => ({ passed: false, totalTests: 2, failedTests: 1, failures: [{ testName: 'POST /users', message: '500 Internal Server Error' }], durationMs: 200 }),
      } as never),
      getForFile: () => null,
    };
    const state = { ...stateWithDiff(), task: { ...task, moduleType: 'backend' } };
    const result = await verifierApiStage(state as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
    expect(result.verifierVerdict?.diagnostic).toBe('FIX_IMPL');
  });
});

describe('verifierMutationStage', () => {
  it('skips when mutation disabled in config', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, mutation: { ...deps.config.mutation, enabled: false } };
    const result = await verifierMutationStage(stateWithDiff() as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('PASS');
  });

  it('returns FAIL when mutation score is below threshold', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, mutation: { ...deps.config.mutation, enabled: true, minimumScore: 80, maxTestFiles: 10, timeoutSec: 120, overrides: [] } };
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...orig,
        runMutationTests: async () => ({ mutationScore: 55, totalMutants: 20, killedMutants: 11, survivedMutants: 9, weakTestFiles: ['src/User.test.ts'], durationMs: 500 }),
      } as never),
      getForFile: () => null,
    };
    const result = await verifierMutationStage(stateWithDiff() as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
    expect(result.verifierVerdict?.diagnostic).toBe('FIX_TEST');
  });
});

describe('verifierVisualStage', () => {
  it('skips for backend modules', async () => {
    const state = { ...stateWithDiff(), task: { ...task, moduleType: 'backend' } };
    const deps = makeStubDeps();
    deps.config = { ...deps.config, visual: { ...deps.config.visual, enabled: true } };
    const result = await verifierVisualStage(state as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('PASS');
  });

  it('skips when visual testing disabled', async () => {
    const state = { ...stateWithDiff(), task: { ...task, moduleType: 'frontend' } };
    const deps = makeStubDeps();
    deps.config = { ...deps.config, visual: { ...deps.config.visual, enabled: false } };
    const result = await verifierVisualStage(state as never, deps);
    expect(result.verifierVerdict?.testResult).toBe('PASS');
  });
});

describe('staged verifier pipeline composition', () => {
  it('short-circuits pipeline when typeCheck fails', async () => {
    const deps = makeStubDeps();
    const orig = deps.pluginRegistry.get('typescript');
    let protectionTestsCalled = false;
    deps.pluginRegistry = {
      get: () => ({
        ...orig,
        typeCheck: async () => ({ violations: [{ file: 'src/User.ts', line: 1, ruleId: 'TS2304', message: 'Cannot find name', resolutionHint: 'import it' }] }),
        runProtectionTests: async () => { protectionTestsCalled = true; return { passed: true, totalTests: 1, failedTests: 0, failures: [], coverageReport: null, durationMs: 50 }; },
      } as never),
      getForFile: () => null,
    };
    let s = stateWithDiff() as never;
    s = await verifierTypeCheckStage(s, deps);
    // TypeCheck failed — tests stage should skip
    s = await verifierTestsStage(s, deps);
    expect(protectionTestsCalled).toBe(false);
    expect(s.verifierVerdict?.testResult).toBe('FAIL');
    expect(s.verifierVerdict?.diagnostic).toBe('AMBIGUOUS');
  });
});
