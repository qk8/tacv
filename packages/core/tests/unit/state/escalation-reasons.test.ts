import { describe, it, expectTypeOf } from 'vitest';
import type { EscalationReason } from '../../../src/state/transitions.js';

describe('EscalationReason', () => {
  it('baseline failing reason must be a valid EscalationReason', () => {
    // This test ensures the baseline HITL path uses a valid EscalationReason.
    // The literal 'max_cycles_without_progress' is NOT valid — it should be
    // 'stagnation' (baseline failures are a form of stagnation before start).
    // If this test fails to compile, the workflow is using an invalid literal.
    const baselineReason: EscalationReason = 'stagnation';
    expectTypeOf(baselineReason).toBeString();

    // 'max_cycles_without_progress' should NOT be assignable:
    // @ts-expect-error — this literal is not a member of EscalationReason
    const invalid: EscalationReason = 'max_cycles_without_progress';
  });

  it('all known escalation reasons are valid', () => {
    const reasons: EscalationReason[] = [
      'budget_exceeded',
      'low_confidence',
      'max_cycles_reached',
      'all_branches_failed',
      'stagnation',
      'high_ambiguity_before_start',
      'suspected_test_fault',
      'test_fault_needs_human_approval',
      'baseline_tests_failing',
    ];
    expect(reasons.length).toBeGreaterThan(0);
  });
});
