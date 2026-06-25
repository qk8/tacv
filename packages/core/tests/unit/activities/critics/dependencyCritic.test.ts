import { describe, it, expect, vi } from 'vitest';
import { dependencyCritic, extractAddedDependencies } from '../../../../src/activities/critics/dependencyCritic.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'dep1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('extractAddedDependencies', () => {
  it('extracts npm deps from package.json diff', () => {
    const proposal = { diffs: [{ filePath: 'package.json', operation: 'modify' as const, diffContent: '+  "lodash": "4.17.21"', language: 'json' }], summary: '', testFilePaths: [] };
    const deps = extractAddedDependencies(proposal);
    expect(deps.some(d => d.name === 'lodash')).toBe(true);
  });

  it('returns empty for non-dependency files', () => {
    const proposal = { diffs: [{ filePath: 'src/util.ts', operation: 'modify' as const, diffContent: '+  const x = 1;', language: 'typescript' }], summary: '', testFilePaths: [] };
    expect(extractAddedDependencies(proposal)).toHaveLength(0);
  });
});

describe('dependencyCritic', () => {
  it('returns empty when no dependencies added', async () => {
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/util.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'typescript' }], summary: '', testFilePaths: [] } };
    expect(await dependencyCritic(state as never, makeStubDeps())).toHaveLength(0);
  });

  it('handles OSV API unavailability gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'package.json', operation: 'modify' as const, diffContent: '+  "lodash": "4.17.21"', language: 'json' }], summary: '', testFilePaths: [] } };
    const findings = await dependencyCritic(state as never, makeStubDeps());
    expect(Array.isArray(findings)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('surfaces vulnerabilities from OSV API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ vulns: [{ id: 'GHSA-test', summary: 'Critical XSS vulnerability', database_specific: { severity: 'CRITICAL' } }] }) }));
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'package.json', operation: 'modify' as const, diffContent: '+  "vulnerable-lib": "1.0.0"', language: 'json' }], summary: '', testFilePaths: [] } };
    const findings = await dependencyCritic(state as never, makeStubDeps());
    expect(findings.some(f => f.critic === 'dependency_vuln')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('returns empty when no diffProposal', async () => {
    const state = createInitialState(task);
    expect(await dependencyCritic(state as never, makeStubDeps())).toHaveLength(0);
  });
});
