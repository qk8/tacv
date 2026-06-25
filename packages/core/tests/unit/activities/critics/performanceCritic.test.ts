import { describe, it, expect, vi } from 'vitest';
import { performanceCritic } from '../../../../src/activities/critics/performanceCritic.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'pc1', description: 'test', mode: 'BROWNFIELD' as const, moduleType: 'java-backend', languageIds: ['java'] };

describe('performanceCritic', () => {
  it('returns empty when performance.enabled is false', async () => {
    const state = createInitialState(task);
    expect(await performanceCritic(state, makeStubDeps())).toHaveLength(0);
  });

  it('returns empty when no diffProposal', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, performance: { enabled: true, regressionThreshold: 0.2, timeoutSec: 60 } };
    expect(await performanceCritic(createInitialState(task), deps)).toHaveLength(0);
  });

  it('returns empty for frontend modules', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, performance: { enabled: true, regressionThreshold: 0.2, timeoutSec: 60 } };
    const frontendTask = { ...task, moduleType: 'ts-frontend' };
    const state = { ...createInitialState(frontendTask), diffProposal: { diffs: [{ filePath: 'src/App.tsx', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'ts' }], summary: '', testFilePaths: [] } };
    expect(await performanceCritic(state as never, deps)).toHaveLength(0);
  });

  it('stores baseline on first run and returns no findings', async () => {
    const addSpy = vi.fn().mockResolvedValue('id1');
    const deps = makeStubDeps();
    deps.config = { ...deps.config, performance: { enabled: true, regressionThreshold: 0.2, timeoutSec: 60 } };
    deps.memory = { ...deps.memory, search: vi.fn().mockResolvedValue([]), add: addSpy };
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/Service.java', operation: 'modify' as const, diffContent: '+ int x = 1;', language: 'java' }], summary: '', testFilePaths: [] } };
    const findings = await performanceCritic(state as never, deps);
    expect(findings).toHaveLength(0);
    expect(addSpy).toHaveBeenCalled();
  });
});
