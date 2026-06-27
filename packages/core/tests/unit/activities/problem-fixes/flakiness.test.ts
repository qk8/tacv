import { describe, it, expect, vi } from 'vitest';
import { flakinessCheckImpl } from '../../../../src/activities/flakiness/impl.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'fl1', description: 'Test flakiness', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

function failingState(file = 'src/UserService.test.ts') {
  return {
    ...createInitialState(task),
    correctionCycle: { attemptCount: 2, branchName: 'main', lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
    verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ testName: 'user test', message: 'race condition', file }], blockedByCritic: false, confidenceScore: 0.7 },
  };
}

describe('flakinessCheckImpl', () => {
  it('skips when flakiness.enabled is false', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, flakiness: { enabled: false, runCount: 3, passThreshold: 1.0 } };
    const result = await flakinessCheckImpl(failingState() as never, deps);
    expect(result.currentPhase).toBe('TEST_VALIDITY_REVIEW');
    expect(result.flakinessReport).toBeNull();
  });

  it('skips when no failures present', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, flakiness: { enabled: true, runCount: 3, passThreshold: 1.0 } };
    const state = createInitialState(task);
    const result = await flakinessCheckImpl(state as never, deps);
    expect(result.flakinessReport).toBeNull();
  });

  it('detects flaky test when it passes sometimes', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, flakiness: { enabled: true, runCount: 3, passThreshold: 1.0 } };
    let callCount = 0;
    const _savedPlugin1 = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({ ..._savedPlugin1,
        runAcceptanceTests: async () => {
          callCount++;
          return { passed: callCount % 2 === 0, totalTests: 1, failedTests: callCount % 2 === 0 ? 0 : 1, failures: [], coverageReport: null, durationMs: 50 };
        },
      } as never),
      getForFile: () => null,
    };
    const result = await flakinessCheckImpl(failingState() as never, deps);
    expect(result.flakinessReport).not.toBeNull();
    expect(result.flakinessReport!.flakyTests.length).toBeGreaterThan(0);
  });

  it('does not flag stable failing tests', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, flakiness: { enabled: true, runCount: 3, passThreshold: 1.0 } };
    const _savedPlugin2 = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({ ..._savedPlugin2,
        runAcceptanceTests: async () => ({ passed: false, totalTests: 1, failedTests: 1, failures: [{ message: 'consistent fail' }], coverageReport: null, durationMs: 50 }),
      } as never),
      getForFile: () => null,
    };
    const result = await flakinessCheckImpl(failingState() as never, deps);
    expect(result.flakinessReport?.flakyTests ?? []).toHaveLength(0);
  });

  it('adds audit entry when flakiness detected', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, flakiness: { enabled: true, runCount: 2, passThreshold: 1.0 } };
    let call = 0;
    const _savedPlugin3 = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({ ..._savedPlugin3,
        runAcceptanceTests: async () => { call++; return { passed: call === 1, totalTests: 1, failedTests: call === 1 ? 0 : 1, failures: [], coverageReport: null, durationMs: 10 }; },
      } as never),
      getForFile: () => null,
    };
    const result = await flakinessCheckImpl(failingState() as never, deps);
    if (result.flakinessReport) {
      expect(result.workflowAuditTrail.some(e => e.decision === 'flaky_tests_detected')).toBe(true);
    }
  });
});
