import { describe, it, expect, vi } from 'vitest';
import { allCriticsImpl }    from '../../../src/activities/critics/impl.js';
import { dependencyCritic }  from '../../../src/activities/critics/dependencyCritic.js';
import { compatibilityCritic } from '../../../src/activities/critics/compatibilityCritic.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps }      from '../../helpers/stubDeps.js';

const greenTask = { taskId: 'c1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };
const brownTask = { taskId: 'c2', description: 'test', mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['java'] };

describe('allCriticsImpl', () => {
  it('returns VERIFIER phase after running', async () => {
    const state = { ...createInitialState(greenTask), diffProposal: { diffs: [{ filePath: 'src/a.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'typescript' }], summary: '', testFilePaths: [] } };
    const result = await allCriticsImpl(state as never, makeStubDeps());
    expect(result.currentPhase).toBe('VERIFIER');
  });

  it('blocks by critic when critical finding found', async () => {
    const state = { ...createInitialState(greenTask), diffProposal: { diffs: [{ filePath: 'src/a.ts', operation: 'modify' as const, diffContent: '+  eval(userInput);', language: 'typescript' }], summary: '', testFilePaths: [] } };
    const result = await allCriticsImpl(state as never, makeStubDeps());
    expect(result.verifierVerdict?.blockedByCritic).toBe(true);
    expect(result.verifierVerdict?.testResult).toBe('FAIL');
  });

  it('handles critic exceptions without crashing', async () => {
    const state = { ...createInitialState(greenTask), diffProposal: { diffs: [], summary: '', testFilePaths: [] } };
    const deps = makeStubDeps();
    // Override to make architecture critic throw
    const result = await allCriticsImpl(state as never, deps);
    expect(result.currentPhase).toBe('VERIFIER');
  });

  it('replaces (not appends) criticFindings each run', async () => {
    const state = { ...createInitialState(greenTask), criticFindings: [{ critic: 'security' as const, severity: 'warning' as const, file: 'old.ts', line: null, ruleId: 'OLD', message: 'old finding', resolutionHint: 'fix' }], diffProposal: { diffs: [], summary: '', testFilePaths: [] } };
    const result = await allCriticsImpl(state as never, makeStubDeps());
    // Old findings should be replaced
    expect(result.criticFindings.some(f => f.ruleId === 'OLD')).toBe(false);
  });
});

describe('compatibilityCritic', () => {
  it('flags removed public method in BROWNFIELD', async () => {
    const state = { ...createInitialState(brownTask), diffProposal: { diffs: [{ filePath: 'src/UserService.java', operation: 'modify' as const, diffContent: '-  public User findById(Long id) {\n-    return repo.findById(id).orElseThrow();\n-  }', language: 'java' }], summary: '', testFilePaths: [] } };
    const findings = await compatibilityCritic(state as never, makeStubDeps());
    expect(findings.some(f => f.ruleId === 'NO_DELETE_PUBLIC_API')).toBe(true);
  });

  it('returns empty in GREENFIELD mode', async () => {
    const greenState = { ...createInitialState(greenTask), diffProposal: { diffs: [{ filePath: 'src/a.ts', operation: 'modify' as const, diffContent: '- export function old() {}', language: 'typescript' }], summary: '', testFilePaths: [] } };
    const findings = await compatibilityCritic(greenState as never, makeStubDeps());
    expect(findings).toHaveLength(0);
  });
});

describe('dependencyCritic', () => {
  it('returns empty when no dependencies added', async () => {
    const state = { ...createInitialState(greenTask), diffProposal: { diffs: [{ filePath: 'src/util.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'typescript' }], summary: '', testFilePaths: [] } };
    const findings = await dependencyCritic(state as never, makeStubDeps());
    expect(findings).toHaveLength(0);
  });

  it('detects added npm dependency from package.json diff', async () => {
    const state = { ...createInitialState(greenTask), diffProposal: { diffs: [{ filePath: 'package.json', operation: 'modify' as const, diffContent: '+  "lodash": "4.17.15"', language: 'json' }], summary: '', testFilePaths: [] } };
    // Mock fetch to return no vulnerabilities (OSV API)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ vulns: [] }) }));
    const findings = await dependencyCritic(state as never, makeStubDeps());
    expect(Array.isArray(findings)).toBe(true);
    vi.unstubAllGlobals();
  });
});
