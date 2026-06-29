import { describe, it, expect, vi } from 'vitest';
import { feasibilityCheckImpl } from '../../../src/activities/feasibility/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = {
  taskId: 'f2-1', description: 'Build a multi-module e-commerce platform',
  mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['typescript'],
};

describe('feasibilityCheckImpl — task decomposition (F2)', () => {
  it('decomposes high-complexity low-ambiguity tasks into subtasks', async () => {
    const deps = makeStubDeps();
    // First call: feasibility assessment; Second call: subtask decomposition
    deps.extractor.extract = vi.fn()
      .mockResolvedValueOnce({
        ambiguity: 1,
        complexity: 4,
        risk: 3,
        ambiguities: [],
        shouldEscalateEarly: false,
        escalationReason: null,
      })
      .mockResolvedValueOnce({
        subtasks: [
          { description: 'Implement user module', estimatedComplexity: 'medium' as const },
          { description: 'Implement product catalog', estimatedComplexity: 'medium' as const },
          { description: 'Implement checkout flow', estimatedComplexity: 'low' as const },
        ],
      });
    const state = createInitialState(task);
    const result = await feasibilityCheckImpl(state, deps);

    // Should decompose — complexity >= 4 AND ambiguity < 3 AND not escalating
    expect(result.currentPhase).toBe('VALUE_NODE');
    expect(result.feasibility).not.toBeNull();
    expect(result.feasibility!.escalationReason).toBe('decomposed_into_subtasks');
    // Should store decomposition plan in scratchpad
    expect(result.sessionScratchpad).toContain('subtask');
  });

  it('does not decompose when ambiguity is high', async () => {
    const deps = makeStubDeps();
    deps.extractor.extract = vi.fn().mockResolvedValue({
      ambiguity: 4,
      complexity: 4,
      risk: 2,
      ambiguities: ['unclear requirements'],
      shouldEscalateEarly: true,
      escalationReason: 'high_ambiguity',
    });
    const state = createInitialState(task);
    const result = await feasibilityCheckImpl(state, deps);

    // Should escalate, not decompose
    expect(result.currentPhase).toBe('HITL_ESCALATION');
  });

  it('does not decompose when complexity is low', async () => {
    const deps = makeStubDeps();
    deps.extractor.extract = vi.fn().mockResolvedValue({
      ambiguity: 1,
      complexity: 2,
      risk: 1,
      ambiguities: [],
      shouldEscalateEarly: false,
      escalationReason: null,
    });
    const state = createInitialState(task);
    const result = await feasibilityCheckImpl(state, deps);

    // Should not decompose — complexity < 4
    expect(result.feasibility!.escalationReason).toBeNull();
    expect(result.sessionScratchpad).toBeNull();
  });

  it('does not decompose when risk is also high (triggers escalation instead)', async () => {
    const deps = makeStubDeps();
    deps.extractor.extract = vi.fn().mockResolvedValue({
      ambiguity: 1,
      complexity: 5,
      risk: 5,
      ambiguities: [],
      shouldEscalateEarly: true,
      escalationReason: 'high_risk',
    });
    const state = createInitialState(task);
    const result = await feasibilityCheckImpl(state, deps);

    // Should escalate (complexity >= 4 AND risk >= 4)
    expect(result.currentPhase).toBe('HITL_ESCALATION');
  });

  it('falls back gracefully when decomposition extraction fails', async () => {
    const deps = makeStubDeps();
    // First call returns assessment, second call (decomposition) fails
    const mock = vi.fn()
      .mockResolvedValueOnce({
        ambiguity: 1,
        complexity: 4,
        risk: 2,
        ambiguities: [],
        shouldEscalateEarly: false,
        escalationReason: null,
      })
      .mockRejectedValueOnce(new Error('LLM timeout'));
    deps.extractor.extract = mock;
    const state = createInitialState(task);
    const result = await feasibilityCheckImpl(state, deps);

    // Should still proceed to VALUE_NODE without decomposition
    expect(result.currentPhase).toBe('VALUE_NODE');
    expect(result.feasibility!.escalationReason).toBeNull();
  });
});
