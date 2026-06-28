import { describe, it, expect } from 'vitest';
import { valueNodeImpl } from '../../../src/activities/value-node/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

/**
 * Issue 21: valueNodeImpl silently returns to TDD_GATE when no candidates exist.
 *
 * The actor will proceed to TDD_GATE without a selectedStrategy, meaning
 * every actor prompt will have no strategy context. Complex tasks with
 * no strategy will drift or stagnate.
 *
 * The fix: create a minimal default strategy from the task description.
 */

const task = { taskId: 'test', description: 'Add JWT authentication to user service', mode: 'BROWNFIELD' as const, moduleType: 'java-backend', languageIds: ['java'] };

describe('Issue 21: valueNode creates default strategy when no candidates', async () => {
  it('creates a default strategy from task description when no candidates exist', async () => {
    const state = {
      ...createInitialState(task),
      strategyCandidates: [],
    };

    const result = await valueNodeImpl(state, makeStubDeps());

    // Must have a selected strategy (default)
    expect(result.selectedStrategy).toBeDefined();
    expect(result.selectedStrategy?.strategyId).toContain('default');
    expect(result.selectedStrategy?.description).toContain('Add JWT authentication');
    expect(result.selectedStrategy?.compositeScore).toBe(0.5);
    expect(result.selectedStrategy?.estimatedRisk).toBe('medium');
  });

  it('records default strategy in audit trail with reason', async () => {
    const state = {
      ...createInitialState(task),
      strategyCandidates: [],
    };

    const result = await valueNodeImpl(state, makeStubDeps());

    const auditEntry = result.workflowAuditTrail.find(e => e.node === 'value_node');
    expect(auditEntry).toBeDefined();
    if (auditEntry) {
      expect(auditEntry.decision).toBe('default_strategy_used');
      expect(auditEntry.keyValues.reason).toBe('no_scout_candidates');
    }
  });

  it('uses LLM selection when candidates exist (not default)', async () => {
    // The stub extractor returns {} which fails Zod validation, so the LLM path throws.
    // We just verify the code takes the LLM path (not the default path) by checking
    // that it doesn't produce a 'default' strategy.
    const state = {
      ...createInitialState(task),
      strategyCandidates: [
        { strategyId: 's1', description: 'Strategy A', compositeScore: 0.9, estimatedRisk: 'low' as const, affectedFiles: [] },
      ],
    };

    // With candidates, the code enters the LLM extraction path.
    // The stub returns {} which fails Zod, so it throws — proving we took the LLM path.
    await expect(valueNodeImpl(state, makeStubDeps())).rejects.toThrow();
  });
});
