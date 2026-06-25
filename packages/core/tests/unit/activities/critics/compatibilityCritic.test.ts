import { describe, it, expect, vi } from 'vitest';
import { compatibilityCritic } from '../../../../src/activities/critics/compatibilityCritic.js';
import { createInitialState } from '../../../../src/state/schemas.js';

const brownfieldBase = { taskId: 't1', description: 'd', mode: 'BROWNFIELD' as const, moduleType: 'b', languageIds: ['java'] };
const greenfieldBase = { taskId: 't1', description: 'd', mode: 'GREENFIELD' as const, moduleType: 'b', languageIds: ['java'] };
const deps = { log: { info: vi.fn() } } as any;

const makeState = (diffContent: string, mode: 'GREENFIELD' | 'BROWNFIELD' = 'BROWNFIELD', filePath = 'src/UserService.java') => ({
  ...createInitialState({ ...brownfieldBase, mode }),
  diffProposal: { diffs: [{ filePath, operation: 'modify' as const, diffContent, language: 'java' }], summary: '', testFilePaths: [] },
});

describe('compatibilityCritic', () => {
  it('returns empty in GREENFIELD mode', async () => {
    const state = makeState('- public User findById(String id) {', 'GREENFIELD');
    expect(await compatibilityCritic(state, deps)).toHaveLength(0);
  });
  it('detects deleted public Java method', async () => {
    const f = await compatibilityCritic(makeState('- public User findById(String id) {'), deps);
    expect(f.some(x => x.ruleId === 'NO_DELETE_PUBLIC_API')).toBe(true);
  });
  it('does not flag deleted private method', async () => {
    const f = await compatibilityCritic(makeState('- private void validate(String s) {'), deps);
    expect(f.some(x => x.ruleId === 'NO_DELETE_PUBLIC_API')).toBe(false);
  });
  it('detects field rename in Java entity', async () => {
    const diff = `- private String userName;\n+ private String username;`;
    const state = { ...createInitialState(brownfieldBase), diffProposal: { diffs: [{ filePath: 'src/UserEntity.java', operation: 'modify' as const, diffContent: diff, language: 'java' }], summary: '', testFilePaths: [] } };
    const f = await compatibilityCritic(state, deps);
    expect(f.some(x => x.ruleId === 'SCHEMA_MIGRATION_REQUIRED')).toBe(true);
  });
  it('detects deleted TS exported function', async () => {
    const state = { ...createInitialState(brownfieldBase), diffProposal: { diffs: [{ filePath: 'src/api.ts', operation: 'modify' as const, diffContent: '- export function getUser() {', language: 'typescript' }], summary: '', testFilePaths: [] } };
    const f = await compatibilityCritic(state, deps);
    expect(f.some(x => x.ruleId === 'NO_DELETE_PUBLIC_API')).toBe(true);
  });
  it('returns empty when diffProposal is null', async () => {
    const state = { ...createInitialState(brownfieldBase), diffProposal: null };
    expect(await compatibilityCritic(state, deps)).toHaveLength(0);
  });
  it('skips create operations', async () => {
    const state = { ...createInitialState(brownfieldBase), diffProposal: { diffs: [{ filePath: 'src/New.java', operation: 'create' as const, diffContent: '+ public void newMethod() {}', language: 'java' }], summary: '', testFilePaths: [] } };
    expect(await compatibilityCritic(state, deps)).toHaveLength(0);
  });
  it('uses critic name compatibility', async () => {
    const f = await compatibilityCritic(makeState('- public User getUser() {'), deps);
    f.forEach(x => expect(x.critic).toBe('compatibility'));
  });
  it('severity is critical for breaking change', async () => {
    const f = await compatibilityCritic(makeState('- public User getUser() {'), deps);
    const breaking = f.filter(x => x.ruleId === 'NO_DELETE_PUBLIC_API');
    expect(breaking.every(x => x.severity === 'critical')).toBe(true);
  });
});
