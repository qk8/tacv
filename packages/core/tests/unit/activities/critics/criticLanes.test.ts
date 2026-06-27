import { describe, it, expect } from 'vitest';
import { allCriticsImpl, getCriticDefs, getCriticLanes } from '../../../../src/activities/critics/impl.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const greenTask = {
  taskId: 'cl-1', description: 'Build auth',
  mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'],
};
const brownTask = { ...greenTask, taskId: 'cl-2', mode: 'BROWNFIELD' as const };
const diff = {
  diffs: [{ filePath: 'src/Auth.ts', operation: 'create' as const, diffContent: '+ const x = 1;', language: 'typescript' }],
  summary: 's', testFilePaths: [],
};

describe('getCriticLanes', () => {
  it('returns fastLane and semanticLane arrays', () => {
    const state = { ...createInitialState(greenTask), diffProposal: diff };
    const { fastLane, semanticLane } = getCriticLanes(state as never, makeStubDeps().config);
    expect(Array.isArray(fastLane)).toBe(true);
    expect(Array.isArray(semanticLane)).toBe(true);
  });

  it('fast lane contains security, style, consistency, testPreservation', () => {
    const state = { ...createInitialState(greenTask), diffProposal: diff };
    const { fastLane } = getCriticLanes(state as never, makeStubDeps().config);
    const names = fastLane.map(c => c.name);
    expect(names).toContain('security');
    expect(names).toContain('style');
    expect(names).toContain('consistency');
    expect(names).toContain('test_preservation');
  });

  it('semantic lane contains requirement_trace and scope_creep', () => {
    const state = { ...createInitialState(brownTask), diffProposal: diff };
    const { semanticLane } = getCriticLanes(state as never, makeStubDeps().config);
    const names = semanticLane.map(c => c.name);
    expect(names).toContain('scope_creep');
    expect(names).toContain('requirement_trace');
  });

  it('no critic appears in BOTH fast and semantic lanes', () => {
    const state = { ...createInitialState(greenTask), diffProposal: diff };
    const { fastLane, semanticLane } = getCriticLanes(state as never, makeStubDeps().config);
    const fastNames = new Set(fastLane.map(c => c.name));
    for (const c of semanticLane) {
      expect(fastNames.has(c.name)).toBe(false);
    }
  });

  it('every critic from getCriticDefs appears in exactly one lane', () => {
    const state = { ...createInitialState(greenTask), diffProposal: diff };
    const config = makeStubDeps().config;
    const all = getCriticDefs(state as never, config).map(c => c.name).sort();
    const { fastLane, semanticLane } = getCriticLanes(state as never, config);
    const lanes = [...fastLane.map(c => c.name), ...semanticLane.map(c => c.name)].sort();
    expect(lanes).toEqual(all);
  });
});

describe('allCriticsImpl with lane parameter', () => {
  it('lane=fast only runs fast-lane critics', async () => {
    const state = { ...createInitialState(greenTask), diffProposal: diff };
    let semanticCalled = false;
    const deps = makeStubDeps();
    // scope_creep critic is semantic and uses extractor
    deps.extractor = {
      extract: async () => { semanticCalled = true; return { inScope: [], outOfScope: [] } as never; },
    };
    await allCriticsImpl(state as never, deps, 'fast');
    expect(semanticCalled).toBe(false);
  });

  it('lane=semantic only runs semantic-lane critics', async () => {
    const state = { ...createInitialState(brownTask), diffProposal: diff };
    const deps = makeStubDeps();
    let lintCalled = false;
    const orig = deps.pluginRegistry.get('typescript');
    deps.pluginRegistry = {
      get: () => ({ ...orig, lint: async () => { lintCalled = true; return { violations: [] }; } } as never),
      getForFile: () => ({
        ...orig,
        lint: async () => { lintCalled = true; return { violations: [] }; },
      } as never),
    };
    deps.extractor = { extract: async () => ({ inScope: [], outOfScope: [] } as never) };
    await allCriticsImpl(state as never, deps, 'semantic');
    expect(lintCalled).toBe(false);
  });

  it('lane=all runs both fast and semantic lanes when cycle >= deferCycles', async () => {
    const state = {
      ...createInitialState(brownTask),
      diffProposal: diff,
      // Set cycle past deferral threshold (semanticLaneDeferCycles=1 in stubConfig)
      correctionCycle: { attemptCount: 2, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
    };
    const deps = makeStubDeps();
    let extractorCalled = false;
    deps.extractor = { extract: async () => { extractorCalled = true; return { inScope: ['src/Auth.ts'], outOfScope: [] } as never; } };
    await allCriticsImpl(state as never, deps, 'all');
    expect(extractorCalled).toBe(true);
  });

  it('defers semantic lane when cycle=0 and config.criticLanes.semanticLaneDeferCycles=1', async () => {
    const state = {
      ...createInitialState(brownTask),
      diffProposal: diff,
      correctionCycle: { attemptCount: 0, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
    };
    const deps = makeStubDeps();
    deps.config = { ...deps.config, criticLanes: { alwaysRunSemantic: false, semanticLaneDeferCycles: 1 } };
    let semanticCalled = false;
    deps.extractor = { extract: async () => { semanticCalled = true; return { inScope: [], outOfScope: [] } as never; } };
    // Using lane='all' but with deferred config — should act like 'fast' only on cycle 0
    await allCriticsImpl(state as never, deps, 'all');
    expect(semanticCalled).toBe(false);
  });

  it('runs semantic lane after deferCycles threshold', async () => {
    const state = {
      ...createInitialState(brownTask),
      diffProposal: diff,
      correctionCycle: { attemptCount: 2, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
    };
    const deps = makeStubDeps();
    deps.config = { ...deps.config, criticLanes: { alwaysRunSemantic: false, semanticLaneDeferCycles: 1 } };
    let semanticCalled = false;
    deps.extractor = { extract: async () => { semanticCalled = true; return { inScope: ['src/Auth.ts'], outOfScope: [] } as never; } };
    await allCriticsImpl(state as never, deps, 'all');
    expect(semanticCalled).toBe(true);
  });
});
