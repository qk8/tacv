/**
 * Delta-state architecture.
 *
 * ── Problem this replaces ───────────────────────────────────────────────────
 * In the original design, `WorkflowState` (including the embedded, ever-growing
 * `workflowAuditTrail`, full `rawErrorHistory`, full `diffProposal` diff content,
 * etc.) is passed whole into every activity and returned whole out of every
 * activity. Temporal serializes the complete input and output of every activity
 * call into its event history. At cycle 5+ on a long-running task this means
 * tens of kilobytes of mostly-unchanged data are re-serialized on every single
 * activity dispatch — a cost that scales with total session history, not with
 * what actually changed in that step.
 *
 * ── What this module provides ───────────────────────────────────────────────
 * `diffState` / `applyDelta` / `DeltaLog` let an activity declare "here is what
 * changed" instead of "here is everything, again." `DeltaLog.replay()` proves
 * the two approaches are equivalent: replaying a delta log against an initial
 * state reconstructs exactly the same final state full-object copying would
 * have produced. This is an additive primitive — it does not require rewriting
 * every existing activity (a big-bang state-layer rewrite is itself exactly the
 * kind of large, hard-to-verify change that causes silent agentic regressions).
 * `CodingWorkflowV2` adopts it directly for orchestration-level state; existing
 * activities continue to work unchanged against `WorkflowState`.
 *
 * `AuditTrailLog` demonstrates the same idea applied to the single fastest-growing
 * field in the legacy state object: the audit trail. Instead of living inside
 * `WorkflowState` and being copied on every activity boundary, it is an
 * independent, append-only log that activities/workflows write to directly and
 * that is never threaded through activity input/output.
 */

export interface StateDelta<T extends Record<string, unknown>> {
  readonly changes: Partial<T>;
}

/**
 * Shallow, reference-equality diff between two state objects of the same shape.
 * Activities in this codebase always return new objects for changed fields
 * (the existing convention is `{ ...state, fieldThatChanged: newValue }`), so
 * reference inequality is both cheap and correct for detecting "this field was
 * touched this step" — exactly the granularity an audit/delta log needs.
 */
export function diffState<T extends Record<string, unknown>>(before: T, after: T): StateDelta<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(after) as Array<keyof T>) {
    if (!Object.is(before[key], after[key])) {
      changes[key] = after[key];
    }
  }
  return { changes };
}

/** Pure merge — never mutates `base`. */
export function applyDelta<T extends Record<string, unknown>>(base: T, delta: StateDelta<T>): T {
  return { ...base, ...delta.changes };
}

export interface DeltaLogEntry<T extends Record<string, unknown>> {
  readonly seq: number;
  readonly timestampMs: number;
  readonly activityName: string;
  readonly delta: StateDelta<T>;
}

/**
 * Append-only log of state deltas. The canonical "current state" is computed
 * via `replay()`, mirroring how Temporal itself treats workflow state as a
 * fold over its event history rather than a single mutable cell.
 */
export class DeltaLog<T extends Record<string, unknown>> {
  private readonly entries: Array<DeltaLogEntry<T>> = [];
  private seqCounter = 0;

  record(activityName: string, delta: StateDelta<T>): DeltaLogEntry<T> {
    const entry: DeltaLogEntry<T> = {
      seq: this.seqCounter++,
      timestampMs: Date.now(),
      activityName,
      delta,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Fold all recorded deltas onto `initial` to reconstruct current state. */
  replay(initial: T): T {
    return this.entries.reduce<T>((acc, e) => applyDelta(acc, e.delta), initial);
  }

  entriesSince(seq: number): ReadonlyArray<DeltaLogEntry<T>> {
    return this.entries.filter(e => e.seq >= seq);
  }

  get length(): number {
    return this.entries.length;
  }
}

export interface AuditLogEntry {
  readonly seq: number;
  readonly timestampMs: number;
  readonly node: string;
  readonly decision: string;
  readonly keyValues: Record<string, unknown>;
}

/**
 * Independent, append-only audit log. Unlike `withAuditEntry(state, entry)` in
 * the legacy design — which requires the caller to read `state.workflowAuditTrail`,
 * append, and write the whole (growing) array back onto state — this log owns
 * its own storage. Activities/workflow code call `.append()` and move on; no
 * field of any serialized activity input/output grows as a result.
 */
export class AuditTrailLog {
  private readonly entries: AuditLogEntry[] = [];
  private seqCounter = 0;

  append(node: string, decision: string, keyValues: Record<string, unknown> = {}): AuditLogEntry {
    const entry: AuditLogEntry = { seq: this.seqCounter++, timestampMs: Date.now(), node, decision, keyValues };
    this.entries.push(entry);
    return entry;
  }

  tail(n: number): AuditLogEntry[] {
    return this.entries.slice(-n);
  }

  /** Read-only snapshot — copy semantics, so external mutation can't corrupt the log. */
  all(): readonly AuditLogEntry[] {
    return [...this.entries];
  }

  byNode(node: string): AuditLogEntry[] {
    return this.entries.filter(e => e.node === node);
  }

  get length(): number {
    return this.entries.length;
  }
}
