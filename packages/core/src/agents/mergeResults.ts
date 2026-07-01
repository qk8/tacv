/**
 * Merges the per-node results of the multi-agent team (Test Writer +
 * Implementor, run once per DAG node/lane) into a single structure shaped
 * like the existing `DiffProposal` the verifier pipeline already knows how
 * to consume. This is the seam between the new DAG-driven execution phase
 * and the original, proven staged-verifier / correction-loop machinery —
 * the multi-agent team produces the initial implementation; everything
 * downstream of it (critics, type-check, tests, stagnation, HITL) is
 * untouched and reused as-is.
 */

import type { DiffEntry } from '../state/schemas.js';
import type { AgentTeamResult } from './types.js';

const TEST_FILE_PATTERN = /(\.(test|spec)\.[a-z]+$)|(^|\/)(tests?|__tests__)\//i;

export interface MergedAgentTeamResult {
  readonly diffProposal: { diffs: DiffEntry[]; summary: string; testFilePaths: string[] };
  readonly totalCostUsd: number;
  readonly roleViolations: string[];
  /** Convenience alias — same as diffProposal.diffs, useful for callers that don't need the wrapper. */
  readonly diffs: DiffEntry[];
}

export function mergeAgentTeamDiffs(results: AgentTeamResult[]): MergedAgentTeamResult {
  const diffs = results.flatMap(r => r.diffs);
  const summary = results.map(r => r.summary).filter(Boolean).join(' | ');
  const testFilePaths = diffs.filter(d => TEST_FILE_PATTERN.test(d.filePath)).map(d => d.filePath);
  const totalCostUsd = results.reduce((sum, r) => sum + r.costUsd, 0);
  const roleViolations = results.flatMap(r => r.roleViolations);

  return {
    diffProposal: { diffs, summary, testFilePaths },
    totalCostUsd,
    roleViolations,
    diffs,
  };
}
