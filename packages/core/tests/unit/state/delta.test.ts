import { describe, it, expect } from 'vitest';
import {
  diffState, applyDelta, DeltaLog, AuditTrailLog,
} from '../../../src/state/delta.js';

interface Sample extends Record<string, unknown> {
  a: number; b: string; c: number[]; d: { nested: boolean };
}

const base: Sample = { a: 1, b: 'x', c: [1, 2], d: { nested: false } };

describe('diffState', () => {
  it('produces an empty changes object when nothing changed', () => {
    const delta = diffState(base, { ...base });
    expect(delta.changes).toEqual({});
  });

  it('captures only the keys that actually changed (reference inequality)', () => {
    const after: Sample = { ...base, a: 2 };
    const delta = diffState(base, after);
    expect(delta.changes).toEqual({ a: 2 });
    expect(Object.keys(delta.changes)).toHaveLength(1);
  });

  it('captures multiple changed keys independently', () => {
    const after: Sample = { ...base, a: 2, b: 'y' };
    const delta = diffState(base, after);
    expect(delta.changes).toEqual({ a: 2, b: 'y' });
  });

  it('treats a new array/object reference as changed even if deep-equal (cheap, correct-by-construction since activities always return new objects)', () => {
    const after: Sample = { ...base, c: [1, 2] }; // new array, same contents
    const delta = diffState(base, after);
    expect(delta.changes).toEqual({ c: [1, 2] });
  });
});

describe('applyDelta', () => {
  it('merges delta changes onto a base object', () => {
    const result = applyDelta(base, { changes: { a: 99 } });
    expect(result).toEqual({ ...base, a: 99 });
  });

  it('does not mutate the base object', () => {
    const original = { ...base };
    applyDelta(base, { changes: { a: 99 } });
    expect(base).toEqual(original);
  });

  it('is a no-op for an empty delta', () => {
    const result = applyDelta(base, { changes: {} });
    expect(result).toEqual(base);
    expect(result).not.toBe(base); // still a new object — pure function
  });
});

describe('DeltaLog', () => {
  it('records entries with monotonically increasing sequence numbers', () => {
    const log = new DeltaLog<Sample>();
    const e1 = log.record('bootstrap', { changes: { a: 2 } });
    const e2 = log.record('scout', { changes: { b: 'y' } });
    expect(e1.seq).toBe(0);
    expect(e2.seq).toBe(1);
    expect(log.length).toBe(2);
  });

  it('replays to the same final state as sequential object-spread merging would produce', () => {
    const log = new DeltaLog<Sample>();
    log.record('step1', diffState(base, { ...base, a: 2 }));
    log.record('step2', diffState({ ...base, a: 2 }, { ...base, a: 2, b: 'y' }));
    log.record('step3', diffState({ ...base, a: 2, b: 'y' }, { ...base, a: 2, b: 'y', d: { nested: true } }));

    const replayed = log.replay(base);
    const expected = { ...base, a: 2, b: 'y', d: { nested: true } };
    expect(replayed).toEqual(expected);
  });

  it('reconstructs identical state via replay() regardless of how many steps were taken (correctness equivalence)', () => {
    // Build the same final state two ways: one big delta vs many small deltas.
    const logA = new DeltaLog<Sample>();
    logA.record('one_shot', diffState(base, { ...base, a: 5, b: 'z' }));

    const logB = new DeltaLog<Sample>();
    logB.record('s1', diffState(base, { ...base, a: 5 }));
    logB.record('s2', diffState({ ...base, a: 5 }, { ...base, a: 5, b: 'z' }));

    expect(logA.replay(base)).toEqual(logB.replay(base));
  });

  it('supports retrieving only entries since a given sequence number (for incremental sync)', () => {
    const log = new DeltaLog<Sample>();
    log.record('s1', { changes: { a: 2 } });
    log.record('s2', { changes: { b: 'y' } });
    log.record('s3', { changes: { a: 3 } });
    const since = log.entriesSince(1);
    expect(since.map(e => e.activityName)).toEqual(['s2', 's3']);
  });

  it('tracks only changed-key volume, not full-state volume — the core efficiency property', () => {
    // Simulate 50 activity calls each changing exactly one small field on a
    // state object that also carries a large, unrelated array (e.g. an
    // embedded audit trail in the legacy design). The delta log's recorded
    // payload size should scale with what changed, not with the size of the
    // untouched large field — this is the property that makes delta-state
    // cheap to persist into a Temporal-style event journal.
    const big = Array.from({ length: 5000 }, (_, i) => `entry-${i}`);
    interface Big extends Record<string, unknown> { counter: number; large: string[] }
    let state: Big = { counter: 0, large: big };
    const log = new DeltaLog<Big>();

    for (let i = 0; i < 50; i++) {
      const next: Big = { ...state, counter: state.counter + 1 }; // `large` untouched, same reference
      log.record(`cycle_${i}`, diffState(state, next));
      state = next;
    }

    // Every recorded delta should contain only `counter`, never `large`.
    const touchedLarge = log.entriesSince(0).some(e => 'large' in e.delta.changes);
    expect(touchedLarge).toBe(false);
    expect(state.counter).toBe(50);
    expect(log.replay({ counter: 0, large: big }).counter).toBe(50);
  });
});

describe('AuditTrailLog (external write-ahead log, not embedded in workflow state)', () => {
  it('appends entries with sequence numbers and timestamps, independent of any state object', () => {
    const audit = new AuditTrailLog();
    const e1 = audit.append('bootstrap', 'started', { taskId: 't1' });
    const e2 = audit.append('scout', 'context_built', {});
    expect(e1.seq).toBe(0);
    expect(e2.seq).toBe(1);
    expect(typeof e1.timestampMs).toBe('number');
    expect(audit.length).toBe(2);
  });

  it('returns the most recent N entries via tail()', () => {
    const audit = new AuditTrailLog();
    for (let i = 0; i < 10; i++) audit.append('cycle', `entry_${i}`, {});
    const last3 = audit.tail(3);
    expect(last3.map(e => e.decision)).toEqual(['entry_7', 'entry_8', 'entry_9']);
  });

  it('grows without needing to be threaded through every activity input/output (decoupled from WorkflowState)', () => {
    // The key architectural claim: the log accumulates state internally and
    // exposes read methods, so callers never need to carry a growing array
    // on a serialized state object — there is no `entries` parameter passed
    // back in, unlike `withAuditEntry(state, entry)` in the legacy design.
    const audit = new AuditTrailLog();
    for (let i = 0; i < 500; i++) audit.append('cycle', `entry_${i}`, {});
    expect(audit.length).toBe(500);
    expect(audit.all()).toHaveLength(500);
    // all() returns a read-only snapshot — mutating it must not affect the log
    const snapshot = audit.all() as unknown as Array<unknown>;
    expect(() => { (snapshot as unknown[]).push({}); }).not.toThrow();
    expect(audit.length).toBe(500); // internal state unaffected by external push
  });

  it('filters entries by node, useful for HITL/baseline-style preservation policies', () => {
    const audit = new AuditTrailLog();
    audit.append('bootstrap', 'started', {});
    audit.append('hitl_escalation', 'escalated', { reason: 'budget' });
    audit.append('cycle', 'retry', {});
    audit.append('hitl_escalation', 'resolved', {});
    const hitlOnly = audit.byNode('hitl_escalation');
    expect(hitlOnly).toHaveLength(2);
    expect(hitlOnly.every(e => e.node === 'hitl_escalation')).toBe(true);
  });
});
