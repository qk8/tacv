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

  it('does NOT call plugin.typeCheck — only lint', async () => {
    const deps = makeStubDeps();
    let typeCheckCalled = false;
    const _savedPlugin = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({ ..._savedPlugin, typeCheck: async () => { typeCheckCalled = true; return { violations: [], durationMs: 0 }; }, lint: async () => ({ violations: [] }) } as never),
      getForFile: () => null,
    } as never;
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/a.ts', operation: 'modify' as const, diffContent: '+ fn(42)', language: 'typescript' }], summary: '', testFilePaths: [] } };
    await preflightImpl(state as never, deps);
    expect(typeCheckCalled).toBe(false);
  });

  it('collects lint violations as findings', async () => {
    const deps = makeStubDeps();
    const _savedPlugin = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({
        ..._savedPlugin,
        lint: async () => ({ violations: [{ file: 'src/a.ts', line: 3, ruleId: 'no-console', message: 'console.log used', resolutionHint: 'use logger' }] }),
      } as never),
      getForFile: () => null,
    } as never;
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/a.ts', operation: 'modify' as const, diffContent: '+ console.log("hi")', language: 'typescript' }], summary: '', testFilePaths: [] } };
    const result = await preflightImpl(state as never, deps);
    expect(result.criticFindings.some(f => f.ruleId === 'no-console')).toBe(true);
  });
});
