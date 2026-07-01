import { describe, it, expect } from 'vitest';
import { generateTargetedQuestion, formatQuestionForDisplay } from '../../../../src/activities/hitl/questionGenerator.js';
import type { EscalationReason } from '../../../../src/state/transitions.js';

const ALL_REASONS: EscalationReason[] = [
  'budget_exceeded', 'low_confidence', 'max_cycles_reached', 'all_branches_failed',
  'stagnation', 'high_ambiguity_before_start', 'suspected_test_fault',
  'test_fault_needs_human_approval', 'baseline_tests_failing',
];

describe('generateTargetedQuestion — exhaustive coverage invariant', () => {
  it('produces a non-empty question with at least 2 concrete options for every known escalation reason (no silent fallback to nothing)', () => {
    for (const reason of ALL_REASONS) {
      const q = generateTargetedQuestion({ reason, triedApproaches: [] });
      expect(q.question.length, `reason=${reason} should have a non-empty question`).toBeGreaterThan(0);
      expect(q.options.length, `reason=${reason} should have >= 2 options`).toBeGreaterThanOrEqual(2);
      for (const opt of q.options) {
        expect(opt.label.length).toBeGreaterThan(0);
        expect(['approve', 'reject', 'override']).toContain(opt.actionHint);
      }
    }
  });
});

describe('generateTargetedQuestion — baseline_tests_failing', () => {
  it('frames the question around the pre-existing broken baseline, not the agent\'s own work', () => {
    const q = generateTargetedQuestion({ reason: 'baseline_tests_failing', triedApproaches: [] });
    expect(q.question.toLowerCase()).toContain('baseline');
    expect(q.options.some(o => o.actionHint === 'reject')).toBe(true);
    expect(q.options.some(o => o.actionHint === 'override')).toBe(true);
  });
});

describe('generateTargetedQuestion — test-fault scenarios', () => {
  it('lists the specific affected tests so the human knows exactly what to inspect', () => {
    const q = generateTargetedQuestion({
      reason: 'test_fault_needs_human_approval',
      triedApproaches: [],
      affectedTests: ['AuthServiceTest.shouldRejectExpiredToken', 'AuthServiceTest.shouldRefreshToken'],
    });
    expect(q.summary).toContain('AuthServiceTest.shouldRejectExpiredToken');
    expect(q.summary).toContain('AuthServiceTest.shouldRefreshToken');
  });

  it('offers a distinct option for "the tests are wrong" vs "the implementation is wrong"', () => {
    const q = generateTargetedQuestion({ reason: 'suspected_test_fault', triedApproaches: [] });
    const labels = q.options.map(o => o.label.toLowerCase());
    expect(labels.some(l => l.includes('test'))).toBe(true);
    expect(labels.some(l => l.includes('implementation') || l.includes('code'))).toBe(true);
  });
});

describe('generateTargetedQuestion — budget_exceeded', () => {
  it('offers a budget-extension option and an accept-current-state option', () => {
    const q = generateTargetedQuestion({ reason: 'budget_exceeded', triedApproaches: [], cost: 82.5 });
    expect(q.question).toMatch(/\$?82\.5/);
    const labels = q.options.map(o => o.label.toLowerCase());
    expect(labels.some(l => l.includes('budget') || l.includes('extend'))).toBe(true);
  });
});

describe('generateTargetedQuestion — stagnation with error-type specialization', () => {
  it('produces Spring-bean-specific guidance for BEAN_CREATION_ERROR instead of a generic question', () => {
    const q = generateTargetedQuestion({ reason: 'stagnation', errorType: 'BEAN_CREATION_ERROR', triedApproaches: ['retry A', 'retry B'] });
    expect(q.question.toLowerCase()).toMatch(/bean|spring|dependency injection/);
  });

  it('falls back to a generic-but-still-structured question when errorType is UNKNOWN or omitted', () => {
    const q = generateTargetedQuestion({ reason: 'stagnation', triedApproaches: ['x'] });
    expect(q.question.length).toBeGreaterThan(0);
    expect(q.options.length).toBeGreaterThanOrEqual(2);
  });

  it('includes a count of tried approaches in the summary so the human does not have to read the full audit trail', () => {
    const q = generateTargetedQuestion({ reason: 'stagnation', triedApproaches: ['approach 1', 'approach 2', 'approach 3'] });
    expect(q.summary).toMatch(/3/);
  });
});

describe('generateTargetedQuestion — high_ambiguity_before_start', () => {
  it('frames the question around clarifying requirements, not around fixing a bug', () => {
    const q = generateTargetedQuestion({ reason: 'high_ambiguity_before_start', triedApproaches: [] });
    expect(q.question.toLowerCase()).toMatch(/clarify|ambigu|requirement/);
  });
});

describe('formatQuestionForDisplay', () => {
  it('renders the question, summary, and all options as enumerated, human-readable text', () => {
    const q = generateTargetedQuestion({ reason: 'budget_exceeded', triedApproaches: [], cost: 50 });
    const text = formatQuestionForDisplay(q);
    expect(text).toContain(q.question);
    for (const opt of q.options) expect(text).toContain(opt.label);
  });
});
