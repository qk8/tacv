import { describe, it, expect } from 'vitest';
import { valueNodeImpl } from '../../../src/activities/value-node/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = { taskId: 'vn1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('valueNodeImpl', () => {
  it('returns state unchanged with audit trail when no candidates', async () => {
    const state = { ...createInitialState(task), strategyCandidates: [] };
    const result = await valueNodeImpl(state as never, makeStubDeps());
    expect(result.currentPhase).toBe('TDD_GATE');
    // Should have an audit trail entry for the skip
    const entry = result.workflowAuditTrail.find(e => e.node === 'value_node');
    expect(entry).toBeDefined();
    expect(entry?.decision).toBe('skipped_no_candidates');
  });

  it('calls extractor when candidates exist', async () => {
    const deps = makeStubDeps();
    let extractCalled = false;
    deps.extractor = {
      extract: async () => {
        extractCalled = true;
        return {
          selectedStrategy: { strategyId: 's1', description: 'test', compositeScore: 0.8, estimatedRisk: 'low', affectedFiles: [] },
          prunedStrategies: [],
          rationale: 'best option',
        } as never;
      },
    };
    const state = {
      ...createInitialState(task),
      strategyCandidates: [{ strategyId: 's1', description: 'test', compositeScore: 0.8, estimatedRisk: 'low' as const, affectedFiles: [] }],
    };
    const result = await valueNodeImpl(state as never, deps);
    expect(extractCalled).toBe(true);
    expect(result.currentPhase).toBe('TDD_GATE');
    expect(result.selectedStrategy?.strategyId).toBe('s1');
  });
});
