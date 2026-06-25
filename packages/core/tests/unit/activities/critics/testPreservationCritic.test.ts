import { describe, it, expect } from 'vitest';
import { testPreservationCritic, isTestFile, detectWeakenedAssertions } from '../../../../src/activities/critics/testPreservationCritic.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'tp1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('isTestFile', () => {
  it('identifies .test.ts files', () => expect(isTestFile('src/User.test.ts')).toBe(true));
  it('identifies .spec.ts files', () => expect(isTestFile('src/User.spec.ts')).toBe(true));
  it('identifies Java Test files', () => expect(isTestFile('UserServiceTest.java')).toBe(true));
  it('identifies Java IT files', () => expect(isTestFile('UserServiceIT.java')).toBe(true));
  it('identifies __tests__ directory', () => expect(isTestFile('src/__tests__/api.ts')).toBe(true));
  it('does not flag production files', () => expect(isTestFile('src/UserService.ts')).toBe(false));
});

describe('detectWeakenedAssertions', () => {
  it('detects toBe → toBeTruthy weakening', () => {
    const diff = "-  expect(result).toBe('admin');\n+  expect(result).toBeTruthy();";
    const r = detectWeakenedAssertions(diff);
    expect(r).toHaveLength(1);
    expect(r[0]?.before).toContain('toBe');
    expect(r[0]?.after).toContain('toBeTruthy');
  });
  it('returns empty for strengthened assertions', () => {
    const diff = "-  expect(result).toBeTruthy();\n+  expect(result).toBe('admin');";
    expect(detectWeakenedAssertions(diff)).toHaveLength(0);
  });
});

describe('testPreservationCritic', () => {
  it('flags deleted test methods', async () => {
    const deps = makeStubDeps();
    deps.pluginRegistry = { get: () => ({ ...deps.pluginRegistry.get('ts'), detectDeletedTests: () => ['should process payment'] } as never), getForFile: () => ({ detectDeletedTests: () => ['should process payment'] } as never) };
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/Payment.test.ts', operation: 'modify' as const, diffContent: "- it('should process payment', () => {", language: 'typescript' }], summary: '', testFilePaths: [] } };
    const findings = await testPreservationCritic(state as never, deps);
    expect(findings.some(f => f.ruleId === 'NO_DELETE_TESTS')).toBe(true);
  });

  it('flags deletion of entire test file', async () => {
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/User.test.ts', operation: 'delete' as const, diffContent: "it('a', () => {})", language: 'typescript' }], summary: '', testFilePaths: [] } };
    const findings = await testPreservationCritic(state as never, makeStubDeps());
    expect(findings.some(f => f.ruleId === 'NO_DELETE_TEST_FILE')).toBe(true);
  });

  it('does not flag non-test file modifications', async () => {
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/service.ts', operation: 'modify' as const, diffContent: '- function old() {}', language: 'typescript' }], summary: '', testFilePaths: [] } };
    expect(await testPreservationCritic(state as never, makeStubDeps())).toHaveLength(0);
  });
});
