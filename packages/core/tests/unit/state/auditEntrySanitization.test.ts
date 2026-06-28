import { describe, it, expect } from 'vitest';
import { withAuditEntry, createInitialState } from '../../../src/state/schemas.js';

/**
 * Issue 23: withAuditEntry keyValues can bloat state with large objects.
 *
 * Full arrays of strategy candidates, critic findings, etc., are stored
 * in keyValues. Each audit entry becomes large. For 100 entries × large
 * objects, the Temporal state payload grows significantly.
 *
 * The fix: sanitize keyValues — summarize large arrays and truncate long strings.
 */

const task = { taskId: 'test', description: 'test task', mode: 'BROWNFIELD' as const, moduleType: 'ts-frontend', languageIds: ['typescript'] };

describe('Issue 23: withAuditEntry keyValues sanitization', () => {
  it('summarizes large arrays as [N items]', () => {
    const state = createInitialState(task);
    const largeArray = Array.from({ length: 50 }, (_, i) => ({ id: i, data: 'x'.repeat(100) }));

    const result = withAuditEntry(state, {
      node: 'test', decision: 'test', keyValues: { items: largeArray },
    });

    const entry = result.workflowAuditTrail.at(-1);
    expect(entry).toBeDefined();
    if (entry) {
      expect(entry.keyValues.items).toBe('[50 items]');
    }
  });

  it('preserves small arrays as-is', () => {
    const state = createInitialState(task);
    const smallArray = [{ id: 1 }, { id: 2 }];

    const result = withAuditEntry(state, {
      node: 'test', decision: 'test', keyValues: { items: smallArray },
    });

    const entry = result.workflowAuditTrail.at(-1);
    expect(entry).toBeDefined();
    if (entry) {
      expect(entry.keyValues.items).toEqual([{ id: 1 }, { id: 2 }]);
    }
  });

  it('truncates long strings to ~500 chars', () => {
    const state = createInitialState(task);
    const longString = 'x'.repeat(2000);

    const result = withAuditEntry(state, {
      node: 'test', decision: 'test', keyValues: { longData: longString },
    });

    const entry = result.workflowAuditTrail.at(-1);
    expect(entry).toBeDefined();
    if (entry) {
      const val = entry.keyValues.longData as string;
      expect(typeof val).toBe('string');
      expect(val.length).toBeLessThanOrEqual(500);
    }
  });

  it('preserves short strings as-is', () => {
    const state = createInitialState(task);

    const result = withAuditEntry(state, {
      node: 'test', decision: 'test', keyValues: { short: 'hello' },
    });

    const entry = result.workflowAuditTrail.at(-1);
    expect(entry).toBeDefined();
    if (entry) {
      expect(entry.keyValues.short).toBe('hello');
    }
  });

  it('preserves numbers and booleans as-is', () => {
    const state = createInitialState(task);

    const result = withAuditEntry(state, {
      node: 'test', decision: 'test',
      keyValues: { count: 42, enabled: true, name: 'test' },
    });

    const entry = result.workflowAuditTrail.at(-1);
    expect(entry).toBeDefined();
    if (entry) {
      expect(entry.keyValues.count).toBe(42);
      expect(entry.keyValues.enabled).toBe(true);
      expect(entry.keyValues.name).toBe('test');
    }
  });
});
