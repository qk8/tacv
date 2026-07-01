import { describe, it, expect } from 'vitest';
import { verifyFile, runContinuousVerification, buildInlineFeedback } from '../../../../src/activities/verification/continuousVerifier.js';
import { makeStubDeps, stubPlugin } from '../../../helpers/stubDeps.js';
import type { DiffEntry } from '../../../../src/state/schemas.js';
import type { ILanguagePlugin, LanguagePluginRegistry } from '../../../../src/activities/ActivityDeps.js';

function diff(filePath: string): DiffEntry {
  return { filePath, operation: 'modify', diffContent: 'x', language: 'typescript' };
}

function registryWith(plugin: ILanguagePlugin): LanguagePluginRegistry {
  return { get: () => plugin, getForFile: () => plugin, getForExtension: () => plugin, getAll: () => [plugin], has: () => true };
}

describe('verifyFile — single-file, fail-fast verification', () => {
  it('reports typeCheckOk=true and runs no tests when there are no affected test files', async () => {
    const deps = makeStubDeps({
      pluginRegistry: registryWith({ ...stubPlugin, typeCheck: async () => ({ violations: [], durationMs: 5 }) }),
      codeGraph: { ...makeStubDeps().codeGraph, selectAffectedTests: async () => [] },
    });
    const result = await verifyFile(diff('src/util.ts'), [], deps);
    expect(result.typeCheckOk).toBe(true);
    expect(result.testsOk).toBeNull();
    expect(result.affectedTestFiles).toEqual([]);
  });

  it('runs only the blast-radius-affected tests, and reports them passing', async () => {
    const deps = makeStubDeps({
      pluginRegistry: registryWith({
        ...stubPlugin,
        typeCheck: async () => ({ violations: [], durationMs: 5 }),
        runProtectionTests: async () => ({ passed: true, totalTests: 2, failedTests: 0, failures: [], coverageReport: null, durationMs: 50 }),
      }),
      codeGraph: { ...makeStubDeps().codeGraph, selectAffectedTests: async () => ['src/auth.service.spec.ts'] },
    });
    const result = await verifyFile(diff('src/auth.service.ts'), ['src/auth.service.spec.ts', 'src/unrelated.spec.ts'], deps);
    expect(result.affectedTestFiles).toEqual(['src/auth.service.spec.ts']);
    expect(result.testsOk).toBe(true);
  });

  it('reports testsOk=false with failure detail when affected tests fail', async () => {
    const deps = makeStubDeps({
      pluginRegistry: registryWith({
        ...stubPlugin,
        typeCheck: async () => ({ violations: [], durationMs: 5 }),
        runProtectionTests: async () => ({ passed: false, totalTests: 2, failedTests: 1, failures: [{ message: 'expected 401 got 200', testName: 'rejects expired token' }], coverageReport: null, durationMs: 50 }),
      }),
      codeGraph: { ...makeStubDeps().codeGraph, selectAffectedTests: async () => ['src/auth.service.spec.ts'] },
    });
    const result = await verifyFile(diff('src/auth.service.ts'), ['src/auth.service.spec.ts'], deps);
    expect(result.testsOk).toBe(false);
    expect(result.testFailures).toHaveLength(1);
  });

  it('SKIPS test selection entirely when typecheck fails — fail-fast, no wasted test runs on code that does not compile', async () => {
    let testSelectionCalled = false;
    const deps = makeStubDeps({
      pluginRegistry: registryWith({
        ...stubPlugin,
        typeCheck: async () => ({ violations: [{ file: 'src/broken.ts', message: 'Type error', line: 3, ruleId: 'TS2345', resolutionHint: 'fix the type' }], durationMs: 5 }),
      }),
      codeGraph: { ...makeStubDeps().codeGraph, selectAffectedTests: async () => { testSelectionCalled = true; return ['src/broken.spec.ts']; } },
    });
    const result = await verifyFile(diff('src/broken.ts'), ['src/broken.spec.ts'], deps);
    expect(result.typeCheckOk).toBe(false);
    expect(result.affectedTestFiles).toEqual([]);
    expect(testSelectionCalled).toBe(false);
  });
});

describe('runContinuousVerification — fail-fast across a sequence of file changes within one cycle', () => {
  it('verifies every file and reports allOk=true when nothing fails', async () => {
    const deps = makeStubDeps({
      pluginRegistry: registryWith({ ...stubPlugin, typeCheck: async () => ({ violations: [], durationMs: 1 }) }),
      codeGraph: { ...makeStubDeps().codeGraph, selectAffectedTests: async () => [] },
    });
    const outcome = await runContinuousVerification([diff('a.ts'), diff('b.ts'), diff('c.ts')], [], deps);
    expect(outcome.allOk).toBe(true);
    expect(outcome.firstFailureIndex).toBeNull();
    expect(outcome.results).toHaveLength(3);
  });

  it('stops at the FIRST failing file instead of verifying every file in the batch regardless (the core fail-fast property)', async () => {
    let typeCheckCallCount = 0;
    const deps = makeStubDeps({
      pluginRegistry: registryWith({
        ...stubPlugin,
        typeCheck: async (_repo: string, files: string[]) => {
          typeCheckCallCount += 1;
          const broken = files[0] === 'b.ts';
          return { violations: broken ? [{ file: 'b.ts', message: 'boom', line: 1, ruleId: 'X', resolutionHint: 'fix' }] : [], durationMs: 1 };
        },
      }),
      codeGraph: { ...makeStubDeps().codeGraph, selectAffectedTests: async () => [] },
    });
    const outcome = await runContinuousVerification([diff('a.ts'), diff('b.ts'), diff('c.ts')], [], deps);
    expect(outcome.allOk).toBe(false);
    expect(outcome.firstFailureIndex).toBe(1);
    expect(outcome.results).toHaveLength(2); // a.ts (ok) + b.ts (failed) — c.ts never reached
    expect(typeCheckCallCount).toBe(2);
  });
});

describe('buildInlineFeedback — actionable message for the implementor\'s next turn within the same cycle', () => {
  it('names the file and the number of broken tests', () => {
    const result = {
      filePath: 'src/auth.service.ts', typeCheckOk: true, typeErrors: [],
      affectedTestFiles: ['src/auth.service.spec.ts'], testsOk: false,
      testFailures: [{ message: 'm1' }, { message: 'm2' }],
    };
    const feedback = buildInlineFeedback(result);
    expect(feedback).toContain('auth.service.ts');
    expect(feedback).toMatch(/2 test/);
  });

  it('reports a type error distinctly from a test failure', () => {
    const result = {
      filePath: 'src/broken.ts', typeCheckOk: false,
      typeErrors: [{ file: 'src/broken.ts', message: 'Type error TS2345', line: 3, ruleId: 'TS2345', resolutionHint: 'fix the type' }],
      affectedTestFiles: [], testsOk: null, testFailures: [],
    };
    const feedback = buildInlineFeedback(result);
    expect(feedback.toLowerCase()).toContain('type');
    expect(feedback).not.toMatch(/\d+ test/);
  });
});
