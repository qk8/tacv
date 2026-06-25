import { describe, it, expect } from 'vitest';
import { consistencyCritic } from '../../../../src/activities/critics/consistencyCritic.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'con1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };
function makeState(diffContent: string) {
  return { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/service.ts', operation: 'modify' as const, diffContent, language: 'typescript' }], summary: '', testFilePaths: [] } };
}

describe('consistencyCritic', () => {
  it('flags var usage', async () => {
    const findings = await consistencyCritic(makeState('+  var count = 0;') as never, makeStubDeps());
    expect(findings.some(f => f.ruleId === 'PREFER_CONST_LET')).toBe(true);
  });

  it('flags console.log usage', async () => {
    const findings = await consistencyCritic(makeState('+  console.log("debug", result);') as never, makeStubDeps());
    expect(findings.some(f => f.ruleId === 'NO_CONSOLE_IN_PROD')).toBe(true);
  });

  it('ignores test files', async () => {
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/service.test.ts', operation: 'modify' as const, diffContent: '+  console.log("test debug");', language: 'typescript' }], summary: '', testFilePaths: [] } };
    const findings = await consistencyCritic(state as never, makeStubDeps());
    expect(findings).toHaveLength(0);
  });

  it('ignores delete operations', async () => {
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/service.ts', operation: 'delete' as const, diffContent: 'var old = 1;', language: 'typescript' }], summary: '', testFilePaths: [] } };
    const findings = await consistencyCritic(state as never, makeStubDeps());
    expect(findings).toHaveLength(0);
  });

  it('flags TODO without ticket', async () => {
    const findings = await consistencyCritic(makeState('+  // TODO: fix this') as never, makeStubDeps());
    expect(findings.some(f => f.ruleId === 'TODO_WITHOUT_TICKET')).toBe(true);
  });

  it('allows TODO with ticket', async () => {
    const findings = await consistencyCritic(makeState('+  // TODO(PROJ-123): fix this ticket') as never, makeStubDeps());
    expect(findings.some(f => f.ruleId === 'TODO_WITHOUT_TICKET')).toBe(false);
  });

  it('returns empty for clean code', async () => {
    const findings = await consistencyCritic(makeState('+  const result = await service.process(dto);') as never, makeStubDeps());
    expect(findings).toHaveLength(0);
  });
});
