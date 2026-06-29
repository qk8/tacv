import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flakinessCheckImpl } from '../../../src/activities/flakiness/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = { taskId: 'fh1', description: 'Fix flaky test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('flakinessCheckImpl heartbeat', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reports heartbeat between test iterations', async () => {
    const heartbeatSpy = vi.fn();
    const deps = makeStubDeps({ heartbeat: heartbeatSpy });

    const state = {
      ...createInitialState(task),
      verifierVerdict: {
        testFailures: [
          { file: 'src/FlakyTest.test.ts', message: 'timeout', line: 10 },
        ],
        apiFailures: [],
        mutationFailures: [],
        typeCheckFailures: [],
        visualFailures: [],
        confidenceScore: 0.3,
      },
    } as never;

    deps.config = { ...deps.config, flakiness: { ...deps.config.flakiness, runCount: 3 } };

    await flakinessCheckImpl(state, deps);

    // With runCount=3, expect 3 heartbeat calls
    expect(heartbeatSpy).toHaveBeenCalledTimes(3);
  });

  it('skips heartbeat when flakiness check is disabled', async () => {
    const heartbeatSpy = vi.fn();
    const deps = makeStubDeps({ heartbeat: heartbeatSpy });
    deps.config = { ...deps.config, flakiness: { ...deps.config.flakiness, enabled: false } };

    const state = createInitialState(task);
    await flakinessCheckImpl(state, deps);

    expect(heartbeatSpy).not.toHaveBeenCalled();
  });

  it('handles missing heartbeat gracefully', async () => {
    const deps = makeStubDeps();
    // Explicitly remove heartbeat to test optional handling
    deps.heartbeat = undefined;

    const state = {
      ...createInitialState(task),
      verifierVerdict: {
        testFailures: [
          { file: 'src/FlakyTest.test.ts', message: 'timeout', line: 10 },
        ],
        apiFailures: [],
        mutationFailures: [],
        typeCheckFailures: [],
        visualFailures: [],
        confidenceScore: 0.3,
      },
    } as never;

    deps.config = { ...deps.config, flakiness: { ...deps.config.flakiness, runCount: 2 } };

    // Should not throw when heartbeat is undefined
    await expect(flakinessCheckImpl(state, deps)).resolves.not.toThrow();
  });
});
