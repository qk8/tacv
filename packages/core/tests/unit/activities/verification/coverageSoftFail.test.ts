import { describe, it, expect } from 'vitest';
import { verifierTestsStage } from '../../../../src/activities/verification/stages.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'cov1', description: 'coverage soft fail', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };
const diff  = {
  diffs: [{ filePath: 'src/User.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'typescript' }],
  summary: 's', testFilePaths: ['src/User.test.ts'],
};

describe('Issue 20: Coverage regression is a soft fail', () => {
  it('returns PASS when tests pass despite coverage regression below baseline', async () => {
    const deps = makeStubDeps();
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...orig,
        runProtectionTests: async () => ({ passed: true, totalTests: 3, failedTests: 0, failures: [], coverageReport: { lines: 75, branches: 60, functions: 80, statements: 76 }, durationMs: 50 }),
        runAcceptanceTests: async () => ({ passed: true, totalTests: 1, failedTests: 0, failures: [], coverageReport: { lines: 70, branches: 55, functions: 75, statements: 71 }, durationMs: 50 }),
      } as never),
      getForFile: () => null,
    } as never;
    const state = {
      ...createInitialState(task),
      diffProposal: diff,
      baselineTestResult: { coverageReport: { lines: 85, branches: 70, functions: 85, statements: 86 } },
    } as never;
    const result = await verifierTestsStage(state, deps);
    // Tests pass → verifier should PASS even though coverage regressed
    expect(result.verifierVerdict?.testResult).toBe('PASS');
  });

  it('returns PASS when no baseline and coverage below minimum threshold', async () => {
    const deps = makeStubDeps();
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...orig,
        runProtectionTests: async () => ({ passed: true, totalTests: 3, failedTests: 0, failures: [], coverageReport: { lines: 50, branches: 40, functions: 55, statements: 52 }, durationMs: 50 }),
        runAcceptanceTests: async () => ({ passed: true, totalTests: 1, failedTests: 0, failures: [], coverageReport: null, durationMs: 50 }),
      } as never),
      getForFile: () => null,
    } as never;
    const state = { ...createInitialState(task), diffProposal: diff, baselineTestResult: null } as never;
    const result = await verifierTestsStage(state, deps);
    expect(result.verifierVerdict?.testResult).toBe('PASS');
  });

  it('records coverage regression in audit trail as warning', async () => {
    const deps = makeStubDeps();
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...orig,
        runProtectionTests: async () => ({ passed: true, totalTests: 3, failedTests: 0, failures: [], coverageReport: { lines: 75, branches: 60, functions: 80, statements: 76 }, durationMs: 50 }),
        runAcceptanceTests: async () => ({ passed: true, totalTests: 1, failedTests: 0, failures: [], coverageReport: { lines: 70, branches: 55, functions: 75, statements: 71 }, durationMs: 50 }),
      } as never),
      getForFile: () => null,
    } as never;
    const state = {
      ...createInitialState(task),
      diffProposal: diff,
      baselineTestResult: { coverageReport: { lines: 85, branches: 70, functions: 85, statements: 86 } },
    } as never;
    const result = await verifierTestsStage(state, deps);
    // Should record as COVERAGE_WARNING (with PASS verdict), not FAIL_COVERAGE
    expect(result.workflowAuditTrail.some(e => e.node === 'verifier_tests' && e.decision === 'COVERAGE_WARNING')).toBe(true);
    expect(result.workflowAuditTrail.some(e => e.node === 'verifier_tests' && e.decision === 'FAIL_COVERAGE')).toBe(false);
  });

  it('still returns FAIL when tests fail AND coverage regresses', async () => {
    const deps = makeStubDeps();
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...orig,
        runProtectionTests: async () => ({ passed: false, totalTests: 3, failedTests: 1, failures: [{ testName: 'T1', message: 'assertion error' }], coverageReport: { lines: 75, branches: 60, functions: 80, statements: 76 }, durationMs: 50 }),
      } as never),
      getForFile: () => null,
    } as never;
    const state = {
      ...createInitialState(task),
      diffProposal: diff,
      baselineTestResult: { coverageReport: { lines: 85, branches: 70, functions: 85, statements: 86 } },
    } as never;
    const result = await verifierTestsStage(state, deps);
    // Protection test failure is still a hard fail
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
    expect(result.verifierVerdict?.diagnostic).toBe('FIX_IMPL');
  });

  it('does not flag coverage when both baseline and current are above thresholds', async () => {
    const deps = makeStubDeps();
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...orig,
        runProtectionTests: async () => ({ passed: true, totalTests: 3, failedTests: 0, failures: [], coverageReport: { lines: 82, branches: 68, functions: 85, statements: 80 }, durationMs: 50 }),
        runAcceptanceTests: async () => ({ passed: true, totalTests: 1, failedTests: 0, failures: [], coverageReport: { lines: 80, branches: 67, functions: 84, statements: 79 }, durationMs: 50 }),
      } as never),
      getForFile: () => null,
    } as never;
    const state = {
      ...createInitialState(task),
      diffProposal: diff,
      baselineTestResult: { coverageReport: { lines: 78, branches: 65, functions: 82, statements: 77 } },
    } as never;
    const result = await verifierTestsStage(state, deps);
    expect(result.verifierVerdict?.testResult).toBe('PASS');
    // No warning when coverage is within acceptable range
    expect(result.workflowAuditTrail.some(e => e.node === 'verifier_tests' && e.decision === 'COVERAGE_WARNING')).toBe(false);
  });
});
