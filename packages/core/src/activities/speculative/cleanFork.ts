/**
 * Clean speculative branch forking.
 *
 * ── Problem this replaces ───────────────────────────────────────────────────
 * In the original `CodingWorkflow`, each `SpeculativeBranchWorkflow` child
 * receives a full copy of `parentState` — including the failure history,
 * critic findings, and debug observations from whichever attempt triggered
 * speculation. `gitCheckpoint` is opt-in (`enabled: false` by default) and
 * the speculative-branch log line falls back to `gitBase: ... ?? 'dirty-tree'`,
 * meaning branches can silently fork from an uncommitted, possibly broken
 * working tree. Diversification relies solely on a negative `avoidHint`
 * string ("do NOT use these approaches") — a weak forcing function for an
 * LLM, which is more reliable at following positive instructions than
 * negative ones.
 *
 * ── What this module provides ───────────────────────────────────────────────
 * `requireCleanForkBase` makes the git checkpoint mandatory: it throws rather
 * than silently falling back when no valid checkpoint exists, so a missing
 * checkpoint is a loud configuration error instead of a quiet correctness
 * bug. `pruneStateForFork` produces the actual state each branch should
 * start from: failure history, critic findings, debug observations, the
 * failed diff proposal, and the audit trail are all cleared, while durable
 * context (task spec, AGENTS.md conventions, the implementation plan, and
 * money already spent) is preserved. `assignStrategyTaxonomy` replaces the
 * avoid-hint-only mechanism with a fixed taxonomy of constructive directives
 * cycled across candidates, so branches are diversified by a *positive*
 * instruction about what to do, not only what to avoid.
 */

import type { WorkflowState, StrategyCandidate } from '../../state/schemas.js';

export function pruneStateForFork(state: WorkflowState): WorkflowState {
  return {
    ...state,
    correctionCycle: {
      attemptCount: 0,
      branchName: null,
      lastErrorHash: null,
      errorHistory: [],
      rawErrorHistory: [],
      stagnationPattern: 'none',
      lastOutcomeSignature: null,
    },
    criticFindings: [],
    criticErrors: [],
    debugObservations: null,
    diffProposal: null,
    verifierVerdict: null,
    testValidityFlag: null,
    flakinessReport: null,
    scopeViolations: [],
    workflowAuditTrail: [],
    confidenceScore: 1.0,
    // Preserved deliberately: task, agentsMdContext, contextSkeleton,
    // blastRadiusMap, gitBlameContext, feasibility, implementationPlan,
    // strategyCandidates/selectedStrategy, exhaustedBranches, cumulativeCostUsd,
    // gitCheckpoint (the fork base itself), sessionScratchpad.
  };
}

/**
 * Throws loudly if there is no valid git checkpoint to fork from, instead of
 * the original's silent `?? 'dirty-tree'` fallback. Callers (the workflow's
 * SPECULATIVE_BRANCH handler) should call this BEFORE launching any child
 * workflow — a configuration that disables git checkpointing is now a hard
 * error at the speculative-branch boundary, not a quiet correctness gap.
 */
export function requireCleanForkBase(state: WorkflowState): string {
  const hash = state.gitCheckpoint?.commitHash;
  if (!hash) {
    throw new Error(
      'requireCleanForkBase: no valid git checkpoint available to fork speculative branches from. ' +
      'Speculative branching requires config.gitCheckpoint.enabled=true and at least one successful ' +
      'checkpoint — forking from an uncommitted working tree is not permitted.',
    );
  }
  return hash;
}

export type StrategyTaxonomy = 'from_scratch' | 'minimal_adaptation' | 'alternative_pattern';

const TAXONOMY_ORDER: StrategyTaxonomy[] = ['from_scratch', 'minimal_adaptation', 'alternative_pattern'];

const TAXONOMY_DIRECTIVES: Record<StrategyTaxonomy, string> = {
  from_scratch:
    'Implement this requirement from scratch. Do not reference or reuse the current implementation in this ' +
    'area of the code — design the solution as if writing it for the first time, then reconcile with the ' +
    'existing surrounding code only at the integration points.',
  minimal_adaptation:
    'Make the smallest possible change to the existing implementation that satisfies the requirement. ' +
    'Prefer extending or lightly modifying current structures over introducing new ones.',
  alternative_pattern:
    'Use a fundamentally different architectural or design pattern than what is currently in place for this ' +
    'area of the code — for example, a different state-management approach, a different data-access pattern, ' +
    'or a different control-flow structure than the existing code uses.',
};

export interface TaxonomyAssignment {
  readonly candidate: StrategyCandidate;
  readonly taxonomy: StrategyTaxonomy;
  readonly directive: string;
}

export function assignStrategyTaxonomy(candidates: StrategyCandidate[]): TaxonomyAssignment[] {
  return candidates.map((candidate, i) => {
    const taxonomy = TAXONOMY_ORDER[i % TAXONOMY_ORDER.length]!; // modulo guarantees a valid index
    return { candidate, taxonomy, directive: TAXONOMY_DIRECTIVES[taxonomy] };
  });
}
