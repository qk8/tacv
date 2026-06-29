import { describe, it, expect } from 'vitest';
import { createInitialState, withAuditEntry, type WorkflowState, type AuditEntry } from '../../../src/state/schemas.js';

const task = { taskId: 'audit1', description: 'Test audit trail eviction', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('Issue 19: Audit trail smart eviction', () => {
  let state: WorkflowState;

  beforeEach(() => {
    state = createInitialState(task);
  });

  function addEntry(node: string, decision: string): void {
    state = withAuditEntry(state, { node, decision, keyValues: {} });
  }

  it('increases cap from 100 to 200 entries with smart pruning', () => {
    // Add 150 entries — should grow freely
    for (let i = 0; i < 150; i++) {
      state = withAuditEntry(state, { node: 'cycle', decision: `entry_${i}`, keyValues: {} });
    }
    expect(state.workflowAuditTrail.length).toBe(150);

    // Add 100 more (total 250) — triggers pruning at 200 → reduces to 150,
    // then 49 more entries accumulate (150 + 49 = 199, still under 200 cap)
    for (let i = 0; i < 100; i++) {
      state = withAuditEntry(state, { node: 'cycle', decision: `entry_${150 + i}`, keyValues: {} });
    }
    expect(state.workflowAuditTrail.length).toBe(199);
  });

  it('preserves first 10 entries (setup phase) when over cap', () => {
    // Add initial setup entries
    addEntry('bootstrap', 'started');
    addEntry('scout', 'context_built');
    addEntry('feasibility_check', 'passed');
    addEntry('value_node', 'strategy_selected');
    addEntry('tdd_gate', 'passed');
    addEntry('baseline_verification', 'passed');

    // Add 195 more entries to trigger cap
    for (let i = 0; i < 195; i++) {
      addEntry('cycle', `entry_${i}`);
    }

    // First 10 entries should be preserved (setup + first few cycles)
    const firstEntry = state.workflowAuditTrail[0];
    expect(firstEntry.node).toBe('bootstrap');
  });

  it('preserves HITL escalation entries across eviction', () => {
    // Add setup entries
    addEntry('bootstrap', 'started');
    addEntry('scout', 'context_built');

    // Add some normal cycle entries
    for (let i = 0; i < 50; i++) {
      addEntry('cycle', `entry_${i}`);
    }

    // Add HITL escalation entries
    addEntry('hitl_escalation', 'escalating_budget_exceeded');
    addEntry('cycle', 'after_hitl');

    addEntry('hitl_escalation', 'escalating_stagnation');

    // Fill up to trigger eviction
    for (let i = 0; i < 150; i++) {
      addEntry('cycle', `entry_extra_${i}`);
    }

    // HITL entries should be preserved
    const hitlEntries = state.workflowAuditTrail.filter(e => e.node === 'hitl_escalation');
    expect(hitlEntries.length).toBe(2);
  });

  it('preserves last 50 entries (recent) when over cap', () => {
    for (let i = 0; i < 250; i++) {
      addEntry('cycle', `entry_${i}`);
    }

    // Last 50 should be the most recent
    const lastEntry = state.workflowAuditTrail[state.workflowAuditTrail.length - 1];
    expect(lastEntry.decision).toBe('entry_249');

    const secondLast = state.workflowAuditTrail[state.workflowAuditTrail.length - 2];
    expect(secondLast.decision).toBe('entry_248');
  });

  it('does not evict when under cap', () => {
    for (let i = 0; i < 50; i++) {
      addEntry('cycle', `entry_${i}`);
    }
    expect(state.workflowAuditTrail.length).toBe(50);
  });
});
