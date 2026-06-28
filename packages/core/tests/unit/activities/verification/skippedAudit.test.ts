import { describe, it, expect } from 'vitest';
import { verifierApiStage, verifierMutationStage } from '../../../../src/activities/verification/stages.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

/**
 * Issue 24: verifierApiStage and verifierMutationStage silently treat errors as PASS.
 *
 * A misconfigured test command will silently pass every cycle. The workflow
 * believes API/mutation tests are passing when they've never run.
 *
 * The fix: distinguish between "tests ran and passed" vs "tests could not run"
 * via a SKIPPED audit event. Do not use PASS for inability-to-run.
 */

const task = { taskId: 'test', description: 'test task', mode: 'BROWNFIELD' as const, moduleType: 'java-backend', languageIds: ['java'] };

function makeStateWithDiff() {
  return {
    ...createInitialState(task),
    diffProposal: {
      diffs: [{ filePath: 'src/App.java', operation: 'modify', diffContent: 'diff', language: 'java' }],
      summary: 'test', testFilePaths: ['src/App.test.java'],
    },
    verifierVerdict: null,
  };
}

describe('Issue 24: API/mutation stage errors produce SKIPPED audit events', () => {
  it('verifierApiStage records SKIPPED audit event on error', async () => {
    const state = makeStateWithDiff();
    // Override the plugin to throw on runApiTests
    const deps = makeStubDeps({
      pluginRegistry: {
        get: () => ({
          ...makeStubDeps().pluginRegistry.get('java'),
          runApiTests: async () => { throw new Error('test runner not found'); },
        }),
      },
    });

    const result = await verifierApiStage(state, deps);

    // Should NOT have a FAIL verdict — API errors are non-fatal
    expect(result.verifierVerdict?.testResult).not.toBe('FAIL');

    // But should have a SKIPPED audit entry
    const skippedEntry = result.workflowAuditTrail.find(e => e.node === 'verifier_api' && e.decision === 'SKIPPED_ERROR');
    expect(skippedEntry).toBeDefined();
    if (skippedEntry) {
      expect(skippedEntry.keyValues.hint).toBeDefined();
    }
  });

  it('verifierMutationStage records SKIPPED audit event on error', async () => {
    const state = makeStateWithDiff();
    const deps = makeStubDeps({
      config: {
        ...makeStubDeps().config,
        mutation: { enabled: true, minimumScore: 70, maxTestFiles: 10, timeoutSec: 120, overrides: [] },
      },
      pluginRegistry: {
        get: () => ({
          ...makeStubDeps().pluginRegistry.get('java'),
          runMutationTests: async () => { throw new Error('mutant runner not found'); },
        }),
      },
    });

    const result = await verifierMutationStage(state, deps);

    // Should NOT have a FAIL verdict — mutation errors are non-fatal
    expect(result.verifierVerdict?.testResult).not.toBe('FAIL');

    // But should have a SKIPPED audit entry
    const skippedEntry = result.workflowAuditTrail.find(e => e.node === 'verifier_mutation' && e.decision === 'SKIPPED_ERROR');
    expect(skippedEntry).toBeDefined();
    if (skippedEntry) {
      expect(skippedEntry.keyValues.hint).toBeDefined();
    }
  });
});
