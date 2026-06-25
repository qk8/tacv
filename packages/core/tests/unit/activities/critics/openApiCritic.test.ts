import { describe, it, expect, vi } from 'vitest';
import { openApiCritic } from '../../../../src/activities/critics/openApiCritic.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

const task = { taskId: 'oa1', description: 'test', mode: 'BROWNFIELD' as const, moduleType: 'java-backend', languageIds: ['java'] };

describe('openApiCritic', () => {
  it('returns empty when openApi.enabled is false', async () => {
    const deps = makeStubDeps();
    const state = createInitialState(task);
    expect(await openApiCritic(state, deps)).toHaveLength(0);
  });

  it('returns empty when no diffProposal', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, openApi: { enabled: true } };
    const state = createInitialState(task);
    expect(await openApiCritic(state, deps)).toHaveLength(0);
  });

  it('returns empty when no controller files changed', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('openapi: 3.0.0\ninfo:\n  title: API' as never);
    const deps = makeStubDeps();
    deps.config = { ...deps.config, openApi: { enabled: true } };
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/service.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'ts' }], summary: '', testFilePaths: [] } };
    expect(await openApiCritic(state as never, deps)).toHaveLength(0);
  });
});
