import { describe, it, expect, vi } from 'vitest';
import { allCriticsImpl } from '../../../../src/activities/critics/impl.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'c1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };
const evalDiff = { diffs: [{ filePath: 'src/a.ts', operation: 'modify' as const, diffContent: '+  const x = eval(input);', language: 'typescript' }], summary: '', testFilePaths: [] };
const cleanDiff = { diffs: [{ filePath: 'src/a.ts', operation: 'modify' as const, diffContent: '+  const x = input.toString();', language: 'typescript' }], summary: '', testFilePaths: [] };

describe('allCriticsImpl', () => {
  it('transitions to VERIFIER phase', async () => {
    const state = { ...createInitialState(task), diffProposal: cleanDiff };
    const result = await allCriticsImpl(state as never, makeStubDeps());
    expect(result.currentPhase).toBe('VERIFIER');
  });

  it('blocks when critical security finding detected', async () => {
    const state = { ...createInitialState(task), diffProposal: evalDiff };
    const result = await allCriticsImpl(state as never, makeStubDeps());
    expect(result.verifierVerdict?.blockedByCritic).toBe(true);
  });

  it('replaces criticFindings each run (not appends)', async () => {
    const stateWithOld = { ...createInitialState(task), criticFindings: [{ critic: 'security' as const, severity: 'warning' as const, file: 'old.ts', line: null, ruleId: 'OLD_RULE', message: 'old', resolutionHint: 'fix' }], diffProposal: cleanDiff };
    const result = await allCriticsImpl(stateWithOld as never, makeStubDeps());
    expect(result.criticFindings.some(f => f.ruleId === 'OLD_RULE')).toBe(false);
  });

  it('does not block on warnings-only', async () => {
    const consoleDiff = { diffs: [{ filePath: 'src/a.ts', operation: 'modify' as const, diffContent: '+  console.log("debug");', language: 'typescript' }], summary: '', testFilePaths: [] };
    const state = { ...createInitialState(task), diffProposal: consoleDiff };
    const result = await allCriticsImpl(state as never, makeStubDeps());
    expect(result.verifierVerdict?.blockedByCritic ?? false).toBe(false);
  });
});
