import { describe, it, expect } from 'vitest';
import { securityCritic } from '../../../../src/activities/critics/securityCritic.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 's1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };
function makeState(content: string, filePath = 'src/service.ts') {
  return { ...createInitialState(task), diffProposal: { diffs: [{ filePath, operation: 'modify' as const, diffContent: content, language: 'typescript' }], summary: '', testFilePaths: [] } };
}

describe('securityCritic', () => {
  it('detects eval()', async () => {
    expect((await securityCritic(makeState('+  const r = eval(input);') as never, makeStubDeps())).some(f => f.ruleId === 'NO_EVAL')).toBe(true);
  });
  it('detects innerHTML', async () => {
    expect((await securityCritic(makeState('+  div.innerHTML = userInput;') as never, makeStubDeps())).some(f => f.ruleId === 'NO_INNER_HTML')).toBe(true);
  });
  it('detects hardcoded password', async () => {
    expect((await securityCritic(makeState('+  const password = "secret123";') as never, makeStubDeps())).some(f => f.ruleId === 'HARDCODED_SECRET')).toBe(true);
  });
  it('detects SQL injection pattern', async () => {
    expect((await securityCritic(makeState('+  const q = "SELECT * FROM users WHERE id = " + userId;') as never, makeStubDeps())).some(f => f.ruleId === 'SQL_INJECTION')).toBe(true);
  });
  it('ignores removed lines', async () => {
    expect(await securityCritic(makeState('-  eval(old);') as never, makeStubDeps())).toHaveLength(0);
  });
  it('ignores clean code', async () => {
    expect(await securityCritic(makeState('+  const result = sanitize(input);') as never, makeStubDeps())).toHaveLength(0);
  });
  it('returns empty without diffProposal', async () => {
    expect(await securityCritic(createInitialState(task) as never, makeStubDeps())).toHaveLength(0);
  });
});
