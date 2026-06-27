import { describe, it, expect } from 'vitest';
import { baselineVerificationImpl } from '../../../src/activities/baseline/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = {
  taskId: 'bl-1', description: 'Add feature', mode: 'BROWNFIELD' as const,
  moduleType: 'backend', languageIds: ['typescript'],
};

describe('baselineVerificationImpl', () => {
  it('passes when all existing tests are green', async () => {
    const state  = createInitialState(task);
    const result = await baselineVerificationImpl(state, makeStubDeps());
    expect(result.baselineTestResult?.passed).toBe(true);
    expect(result.baselineTestResult?.failureCount).toBe(0);
    expect(result.currentPhase).toBe('VALUE_NODE');
  });

  it('records duration and timestamp', async () => {
    const before = Date.now();
    const result = await baselineVerificationImpl(createInitialState(task), makeStubDeps());
    expect(result.baselineTestResult?.ranAt).toBeGreaterThanOrEqual(before);
    expect(result.baselineTestResult?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records failures and marks passed=false when tests fail', async () => {
    const deps = makeStubDeps();
    const origPlugin1 = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...origPlugin1,
        runProtectionTests: async () => ({
          passed: false, totalTests: 10, failedTests: 2,
          failures: [
            { testName: 'UserTest::login', message: 'Expected 200 but got 500' },
            { testName: 'AuthTest::refresh', message: 'Token expired' },
          ],
          coverageReport: null, durationMs: 450,
        }),
      } as never),
      getForFile: () => null,
    };
    const result = await baselineVerificationImpl(createInitialState(task), deps);
    expect(result.baselineTestResult?.passed).toBe(false);
    expect(result.baselineTestResult?.failureCount).toBe(2);
    expect(result.baselineTestResult?.failures).toHaveLength(2);
  });

  it('escalates to HITL when baseline fails and failFast=true', async () => {
    const deps = makeStubDeps();
    const origPlugin2 = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...origPlugin2,
        runProtectionTests: async () => ({
          passed: false, totalTests: 5, failedTests: 1,
          failures: [{ testName: 'T1', message: 'broken before we started' }],
          coverageReport: null, durationMs: 100,
        }),
      } as never),
      getForFile: () => null,
    };
    // failFast = true (default in stubConfig)
    const result = await baselineVerificationImpl(createInitialState(task), deps);
    expect(result.currentPhase).toBe('HITL_ESCALATION');
  });

  it('continues past failing baseline when failFast=false', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, baseline: { enabled: true, failFast: false } };
    const origPlugin3 = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ...origPlugin3,
        runProtectionTests: async () => ({
          passed: false, totalTests: 5, failedTests: 1,
          failures: [{ testName: 'T1', message: 'pre-existing failure' }],
          coverageReport: null, durationMs: 100,
        }),
      } as never),
      getForFile: () => null,
    };
    const result = await baselineVerificationImpl(createInitialState(task), deps);
    expect(result.currentPhase).toBe('VALUE_NODE');
    expect(result.baselineTestResult?.passed).toBe(false);
  });

  it('skips and returns VALUE_NODE when disabled', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, baseline: { enabled: false, failFast: true } };
    const result = await baselineVerificationImpl(createInitialState(task), deps);
    expect(result.baselineTestResult).toBeNull();
    expect(result.currentPhase).toBe('VALUE_NODE');
  });

  it('adds an audit trail entry', async () => {
    const result = await baselineVerificationImpl(createInitialState(task), makeStubDeps());
    const entry = result.workflowAuditTrail.find(e => e.node === 'baseline_verification');
    expect(entry).toBeDefined();
  });

  it('uses the language plugin for the first languageId in the task', async () => {
    const calls: string[] = [];
    const deps = makeStubDeps();
    const originalGet = deps.pluginRegistry.get.bind(deps.pluginRegistry);
    deps.pluginRegistry = {
      get: (id: string) => { calls.push(id); return originalGet(id); },
      getForFile: () => null,
    };
    const t = { ...task, languageIds: ['java'] };
    await baselineVerificationImpl(createInitialState(t), deps);
    expect(calls).toContain('java');
  });
});
