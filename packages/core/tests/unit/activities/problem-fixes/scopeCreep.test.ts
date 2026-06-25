import { describe, it, expect, vi } from 'vitest';
import { scopeCreepCritic } from '../../../../src/activities/critics/scopeCreepCritic.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const brownTask = { taskId: 'sc1', description: 'Fix null check in UserService.findById', mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };
const greenTask = { ...brownTask, taskId: 'sc2', mode: 'GREENFIELD' as const };

describe('scopeCreepCritic', () => {
  it('returns empty for GREENFIELD (only applies to BROWNFIELD)', async () => {
    const state = { ...createInitialState(greenTask), diffProposal: { diffs: [{ filePath: 'src/A.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'ts' }, { filePath: 'src/B.ts', operation: 'modify' as const, diffContent: '+ const y = 2;', language: 'ts' }], summary: '', testFilePaths: [] } };
    expect(await scopeCreepCritic(state as never, makeStubDeps())).toHaveLength(0);
  });

  it('returns empty when only one file changed', async () => {
    const state = { ...createInitialState(brownTask), diffProposal: { diffs: [{ filePath: 'src/UserService.ts', operation: 'modify' as const, diffContent: '+ if (id == null) return null;', language: 'ts' }], summary: '', testFilePaths: [] } };
    expect(await scopeCreepCritic(state as never, makeStubDeps())).toHaveLength(0);
  });

  it('detects scope creep when out-of-scope files changed', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: vi.fn().mockResolvedValue({ inScope: ['src/UserService.ts'], outOfScope: [{ file: 'src/EmailService.ts', reason: 'Unrelated to null check fix in UserService' }, { file: 'src/config.ts', reason: 'Configuration change not required by task' }] }) };
    const state = { ...createInitialState(brownTask), diffProposal: { diffs: [{ filePath: 'src/UserService.ts', operation: 'modify' as const, diffContent: '+ if (id == null) return null;', language: 'ts' }, { filePath: 'src/EmailService.ts', operation: 'modify' as const, diffContent: '+ // refactored', language: 'ts' }, { filePath: 'src/config.ts', operation: 'modify' as const, diffContent: '+ timeout: 30', language: 'ts' }], summary: '', testFilePaths: [] } };
    const findings = await scopeCreepCritic(state as never, deps);
    expect(findings.some(f => f.ruleId === 'OUT_OF_SCOPE_CHANGE')).toBe(true);
    expect(findings.length).toBe(2);
    expect(findings.every(f => f.critic === 'scope_creep')).toBe(true);
  });

  it('returns empty when extractor fails gracefully', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: vi.fn().mockRejectedValue(new Error('LLM error')) };
    const state = { ...createInitialState(brownTask), diffProposal: { diffs: [{ filePath: 'src/A.ts', operation: 'modify' as const, diffContent: '', language: 'ts' }, { filePath: 'src/B.ts', operation: 'modify' as const, diffContent: '', language: 'ts' }], summary: '', testFilePaths: [] } };
    expect(await scopeCreepCritic(state as never, deps)).toHaveLength(0);
  });
});
