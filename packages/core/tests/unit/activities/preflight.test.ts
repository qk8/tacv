import { describe, it, expect } from 'vitest';
import { preflightImpl } from '../../../src/activities/preflight/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = { taskId: 'pf1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('preflightImpl', () => {
  it('transitions to CRITICS when diffProposal exists', async () => {
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/a.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'typescript' }], summary: '', testFilePaths: [] } };
    const result = await preflightImpl(state as never, makeStubDeps());
    expect(result.currentPhase).toBe('CRITICS');
  });

  it('returns state unchanged when no diffProposal', async () => {
    const state = createInitialState(task);
    const result = await preflightImpl(state, makeStubDeps());
    expect(result.currentPhase).toBe('CRITICS');
  });

  it('collects type-check violations as critical findings', async () => {
    const deps = makeStubDeps();
    const _savedPlugin1 = deps.pluginRegistry.get('ts');
    deps.pluginRegistry = { get: () => ({ ..._savedPlugin1, typeCheck: async () => ({ violations: [{ file: 'src/a.ts', line: 3, ruleId: 'TS2345', message: 'Argument of type number is not assignable', resolutionHint: 'cast to correct type' }] }), lint: async () => ({ violations: [] }) } as never), getForFile: () => null };
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/a.ts', operation: 'modify' as const, diffContent: '+ fn(42 as any)', language: 'typescript' }], summary: '', testFilePaths: [] } };
    const result = await preflightImpl(state as never, deps);
    expect(result.criticFindings.some(f => f.ruleId === 'TS2345')).toBe(true);
  });
});
