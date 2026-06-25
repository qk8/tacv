import type { WorkflowState, CorrectionCycle } from '../../state/schemas.js';

export function computeErrorHash(failures: string[]): string {
  const sorted = [...failures].sort().join('|');
  // Simple djb2 hash — no crypto needed
  let hash = 5381;
  for (let i = 0; i < sorted.length; i++) {
    hash = (hash * 33) ^ sorted.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export type StagnationPattern = 'none' | 'iteration' | 'semantic' | 'outcome';

export function detectStagnationPattern(
  cycle:      CorrectionCycle,
  newHash:    string,
  threshold:  number = 0.85,
): StagnationPattern {
  if (cycle.attemptCount < 2) return 'none';

  // Same error hash = identical failure (iteration stagnation)
  if (cycle.lastErrorHash && cycle.lastErrorHash === newHash) {
    return 'iteration';
  }

  // Error has appeared before in history (outcome stagnation)
  if (cycle.errorHistory.includes(newHash)) {
    return 'outcome';
  }

  // Check semantic similarity by comparing hash prefixes as a cheap approximation
  // (real implementation would use embedding comparison via Mem0)
  const recentHashes = cycle.errorHistory.slice(-3);
  const similarCount = recentHashes.filter(h => {
    const shared = longestCommonPrefix(h, newHash).length;
    return shared / Math.max(h.length, newHash.length) >= threshold * 0.4;
  }).length;

  if (similarCount >= 2) return 'semantic';

  return 'none';
}

export function updateCorrectionCycle(
  cycle:   CorrectionCycle,
  newHash: string,
  pattern: StagnationPattern,
): CorrectionCycle {
  return {
    ...cycle,
    lastErrorHash:     newHash,
    stagnationPattern: pattern,
    errorHistory:      [...cycle.errorHistory, newHash].slice(-10),
    lastOutcomeSignature: newHash,
  };
}

export function checkStagnationImpl(state: WorkflowState, threshold = 0.85): {
  pattern:  StagnationPattern;
  newCycle: CorrectionCycle;
} {
  const failures = state.verifierVerdict?.testFailures ?? [];
  const errorTexts = failures.map(f => f.message);
  const newHash = computeErrorHash(errorTexts);
  const pattern = detectStagnationPattern(state.correctionCycle, newHash, threshold);
  const newCycle = updateCorrectionCycle(state.correctionCycle, newHash, pattern);
  return { pattern, newCycle };
}

function longestCommonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}
