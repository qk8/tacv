/**
 * Combines `requireCleanForkBase`, `pruneStateForFork`, and
 * `assignStrategyTaxonomy` (see `activities/speculative/cleanFork.ts`) into
 * the single call `CodingWorkflowV2` makes when fanning out into speculative
 * branches — replacing `_diversifyStrategyCandidates` from the original
 * workflow. Each returned state reuses the existing `selectedStrategy.avoidHint`
 * field to carry the new *positive* directive text (no schema change needed:
 * the actor prompt builder already reads this field as freeform strategy
 * guidance, regardless of its name).
 */

import type { WorkflowState, StrategyCandidate } from '../state/schemas.js';
import {
  requireCleanForkBase, pruneStateForFork, assignStrategyTaxonomy, type StrategyTaxonomy,
} from '../activities/speculative/cleanFork.js';

export interface SpeculativeBranchStart {
  readonly state: WorkflowState;
  readonly candidate: StrategyCandidate;
  readonly taxonomy: StrategyTaxonomy;
  readonly directive: string;
}

export function buildSpeculativeBranchStates(
  parentState: WorkflowState,
  candidates: StrategyCandidate[],
): SpeculativeBranchStart[] {
  requireCleanForkBase(parentState); // throws if no valid git checkpoint — mandatory, not opt-in
  const cleaned = pruneStateForFork(parentState);
  const assignments = assignStrategyTaxonomy(candidates);

  return assignments.map(({ candidate, taxonomy, directive }) => ({
    state: { ...cleaned, selectedStrategy: { ...candidate, avoidHint: directive } },
    candidate,
    taxonomy,
    directive,
  }));
}
