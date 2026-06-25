import { describe, it, expect } from 'vitest';
import { securityCritic }        from '../../../src/activities/critics/securityCritic.js';
import { testPreservationCritic } from '../../../src/activities/critics/testPreservationCritic.js';
import { getCriticDefs }          from '../../../src/activities/critics/impl.js';
import { createInitialState }     from '../../../src/state/schemas.js';
import { makeStubDeps }           from '../../helpers/stubDeps.js';

const greenTask = { taskId: 't1', description: 'Add endpoint', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };
const brownTask = { taskId: 't2', description: 'Fix bug', mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

function stateWith(task: typeof greenTask, diffContent: string, filePath = 'src/UserService.ts') {
  return {
    ...createInitialState(task),
    diffProposal: { diffs: [{ filePath, operation: 'modify' as const, diffContent, language: 'typescript' }], summary: 'test', testFilePaths: [] },
  };
}

describe('securityCritic', () => {
  it('detects eval usage', async () => {
    const state = stateWith(greenTask, '+  const result = eval(userInput);');
    const findings = await securityCritic(state as never, makeStubDeps());
    expect(findings.some(f => f.ruleId === 'NO_EVAL')).toBe(true);
  });

  it('detects innerHTML assignment', async () => {
    const state = stateWith(greenTask, '+  el.innerHTML = userInput;');
    const findings = await securityCritic(state as never, makeStubDeps());
    expect(findings.some(f => f.ruleId === 'NO_INNER_HTML')).toBe(true);
  });

  it('detects hardcoded password', async () => {
    const state = stateWith(greenTask, '+  const password = "hunter2";');
    const findings = await securityCritic(state as never, makeStubDeps());
    expect(findings.some(f => f.ruleId === 'HARDCODED_SECRET')).toBe(true);
  });

  it('ignores clean code', async () => {
    const state = stateWith(greenTask, '+  const name = user.getName();');
    const findings = await securityCritic(state as never, makeStubDeps());
    expect(findings).toHaveLength(0);
  });

  it('ignores deleted lines', async () => {
    const state = stateWith(greenTask, '-  el.innerHTML = old;');
    const findings = await securityCritic(state as never, makeStubDeps());
    expect(findings).toHaveLength(0);
  });
});

describe('testPreservationCritic', () => {
  it('flags deleted test case', async () => {
    const diff = '-  it(\'should do something\', () => {';
    const state = stateWith(greenTask, diff, 'src/UserService.test.ts');
    const deps = makeStubDeps();
    deps.pluginRegistry = {
      get: () => ({ metadata: { languageId: 'typescript', extensions: ['.ts', '.tsx'] as const }, detectDeletedTests: () => ['should do something'] } as never),
      getForFile: () => ({ metadata: { languageId: 'typescript', extensions: ['.ts', '.tsx'] as const }, detectDeletedTests: () => ['should do something'] } as never),
    };
    const findings = await testPreservationCritic(state as never, deps as never);
    expect(findings.some(f => f.ruleId === 'NO_DELETE_TESTS')).toBe(true);
  });

  it('does not flag non-test files', async () => {
    const state = stateWith(greenTask, '-  function doSomething() {}', 'src/service.ts');
    const findings = await testPreservationCritic(state as never, makeStubDeps());
    expect(findings).toHaveLength(0);
  });
});

describe('getCriticDefs', () => {
  it('includes architecture critic for GREENFIELD', () => {
    const state = createInitialState(greenTask);
    const defs = getCriticDefs(state as never);
    expect(defs.map(d => d.name)).toContain('architecture');
    expect(defs.map(d => d.name)).not.toContain('compatibility');
  });

  it('includes compatibility critic for BROWNFIELD', () => {
    const state = createInitialState(brownTask);
    const defs = getCriticDefs(state as never);
    expect(defs.map(d => d.name)).toContain('compatibility');
    expect(defs.map(d => d.name)).not.toContain('architecture');
  });

  it('always includes security and test_preservation', () => {
    for (const task of [greenTask, brownTask]) {
      const state = createInitialState(task);
      const names = getCriticDefs(state as never).map(d => d.name);
      expect(names).toContain('security');
      expect(names).toContain('test_preservation');
    }
  });
});
