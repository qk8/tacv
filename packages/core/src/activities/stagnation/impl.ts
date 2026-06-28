import type { WorkflowState, CorrectionCycle } from '../../state/schemas.js';

export type StagnationPattern = 'none' | 'iteration' | 'semantic' | 'outcome';

// ─────────────────────────────────────────────────────────────────────────────
// Jaccard text similarity (replaces hollow hash-prefix comparison)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts meaningful words (4+ chars, lowercase, deduplicated) from an error
 * message for use in Jaccard coefficient calculation.
 *
 * Improvement over TACV original: the previous implementation compared hash
 * PREFIXES as a proxy for semantic similarity, which is meaningless —
 * djb2("Cannot read property 'foo' of undefined") and
 * djb2("Cannot read properties of undefined (reading 'foo')") share zero
 * prefix bits even though they're the same error. This implementation
 * correctly measures word-set overlap.
 */
export function extractMeaningfulWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4);
  return [...new Set(words)]; // deduplicate
}

/**
 * Jaccard similarity between two error messages: |A ∩ B| / |A ∪ B|.
 * Returns 1.0 for identical text, 0.0 for disjoint word sets.
 */
export function computeTextSimilarity(a: string, b: string): number {
  const setA = new Set(extractMeaningfulWords(a));
  const setB = new Set(extractMeaningfulWords(b));
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersect = 0;
  for (const w of setA) {
    if (setB.has(w)) intersect++;
  }
  const union = setA.size + setB.size - intersect;
  return union === 0 ? 1.0 : intersect / union;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash (for exact-match / history lookups — still useful)
// ─────────────────────────────────────────────────────────────────────────────

export function computeErrorHash(failures: string[]): string {
  const sorted = [...failures].sort().join('|');
  let hash = 5381;
  for (let i = 0; i < sorted.length; i++) {
    hash = (hash * 33) ^ sorted.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stagnation detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects stagnation patterns in the correction loop.
 *
 * @param cycle           Current correction cycle state
 * @param newHash         Hash of the current error messages
 * @param threshold       Jaccard similarity threshold for semantic stagnation (default 0.85)
 * @param newErrorTexts   Raw error messages for this cycle (for similarity check)
 * @param historyTexts    Raw error messages from recent cycles (for similarity check)
 *
 * Priority: iteration > outcome > semantic > none
 */
export function detectStagnationPattern(
  cycle:           CorrectionCycle,
  newHash:         string,
  threshold:       number   = 0.85,
  newErrorTexts?:  string[],
  historyTexts?:   string[],
): StagnationPattern {
  if (cycle.attemptCount < 2) return 'none';

  // 1. Exact iteration stagnation — identical error set
  if (cycle.lastErrorHash && cycle.lastErrorHash === newHash) {
    return 'iteration';
  }

  // 2. Outcome stagnation — error has appeared before in history
  if (cycle.errorHistory.includes(newHash)) {
    return 'outcome';
  }

  // 3. Semantic stagnation — Jaccard similarity over raw text
  //    Only possible when callers provide the raw text (checkStagnationImpl does)
  if (newErrorTexts && newErrorTexts.length > 0 && historyTexts && historyTexts.length > 0) {
    const newJoined  = newErrorTexts.join(' ');
    const histJoined = historyTexts.join(' ');
    const similarity = computeTextSimilarity(newJoined, histJoined);
    if (similarity >= threshold) {
      return 'semantic';
    }
  }

  return 'none';
}

export function updateCorrectionCycle(
  cycle:   CorrectionCycle,
  newHash: string,
  pattern: StagnationPattern,
): CorrectionCycle {
  return {
    ...cycle,
    lastErrorHash:        newHash,
    stagnationPattern:    pattern,
    errorHistory:         [...cycle.errorHistory, newHash].slice(-10),
    lastOutcomeSignature: newHash,
  };
}

/**
 * Orchestrates stagnation detection from WorkflowState.
 * Extracts raw error texts and passes them to detectStagnationPattern
 * so Jaccard similarity can be computed.
 */
export function checkStagnationImpl(
  state:     WorkflowState,
  threshold: number = 0.85,  // Jaccard 0.85 = meaningful word overlap threshold (matches config default)
): { pattern: StagnationPattern; newCycle: CorrectionCycle } {
  const failures      = state.verifierVerdict?.testFailures ?? [];
  const errorTexts    = failures.map(f => f.message);
  const newHash       = computeErrorHash(errorTexts);

  // Reconstruct history texts from stored error history metadata
  // (In the redesign, we could also store raw texts in CorrectionCycle.
  //  For now, we use the last stored error messages from workflowAuditTrail.)
  const historyTexts = extractHistoryTexts(state);

  const pattern  = detectStagnationPattern(state.correctionCycle, newHash, threshold, errorTexts, historyTexts);
  const newCycle = updateCorrectionCycle(state.correctionCycle, newHash, pattern);
  return { pattern, newCycle };
}

/**
 * Extracts raw error texts from recent audit trail entries for semantic
 * comparison. Falls back to empty array if no history is available.
 */
function extractHistoryTexts(state: WorkflowState): string[] {
  const recent = state.workflowAuditTrail
    .filter(e => e.node === 'verifier_tests' || e.node === 'verifier_routing')
    .slice(-6);

  return recent.flatMap(e => {
    const failures = e.keyValues['testFailures'];
    if (Array.isArray(failures)) {
      return (failures as Array<{ message?: string }>)
        .map(f => f?.message ?? '')
        .filter(Boolean);
    }
    return [];
  });
}
