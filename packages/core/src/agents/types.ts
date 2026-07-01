import type { DiffEntry } from '../state/schemas.js';

/**
 * Common result shape for narrow, single-node agent-team activities.
 * `roleViolations` surfaces any output the enforcement layer had to drop
 * because it violated the calling agent's role (e.g. the Test Writer
 * producing a non-test file) — kept visible for audit rather than silently
 * discarded.
 */
export interface AgentTeamResult {
  readonly diffs: DiffEntry[];
  readonly summary: string;
  readonly costUsd: number;
  readonly roleViolations: string[];
}
