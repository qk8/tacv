/**
 * Graduated stagnation response ladder.
 *
 * ── Problem this replaces ───────────────────────────────────────────────────
 * In the original `computeVerifierTransition`, the moment
 * `cycle.stagnationPattern !== 'none'` is true even once, the workflow routes
 * straight to `HITL_ESCALATION` — the most expensive, slowest response
 * available, reserved for situations that genuinely need a human. But
 * stagnation is a gradient: seeing the same error twice might just mean the
 * actor's prompt didn't make clear what was already tried; seeing it five
 * times in a row is when a human's judgment is actually needed.
 *
 * ── What this module provides ───────────────────────────────────────────────
 * `trackConsecutiveStagnation` turns the workflow's single latest
 * `stagnationPattern` into a running count of *consecutive* stagnant cycles
 * (reset to 0 the moment a cycle is non-stagnant). `computeLadderDecision`
 * maps that count onto a 5-level proportional response:
 *   1. enrich_prompt        — cheapest: give the actor an explicit "already
 *                              tried" list and ask for a different approach
 *   2. auto_debug           — automatically engage IntelligentDebugger
 *   3. speculative_branch   — parallel diverse strategies
 *   4. targeted_hitl        — human, but with specific generated questions
 *   5. full_escalation      — the original behavior, now the *last* resort
 * This is consumed by `CodingWorkflowV2`'s correction loop in place of the
 * single `if (stagnationPattern !== 'none') -> HITL_ESCALATION` branch.
 */

/** Mirrors the inline literal union on `CorrectionCycle.stagnationPattern` in schemas.ts (not separately exported there). */
export type StagnationPattern = 'none' | 'iteration' | 'semantic' | 'outcome';

export function trackConsecutiveStagnation(previousCount: number, currentPattern: StagnationPattern): number {
  return currentPattern === 'none' ? 0 : previousCount + 1;
}

export type LadderAction =
  | 'none' | 'enrich_prompt' | 'auto_debug' | 'speculative_branch' | 'targeted_hitl' | 'full_escalation';

export interface LadderDecision {
  readonly level: number;
  readonly action: LadderAction;
  readonly reason: string;
}

const LADDER: ReadonlyArray<{ action: LadderAction; reason: string }> = [
  { action: 'none', reason: 'No consecutive stagnation — proceed normally.' },
  { action: 'enrich_prompt', reason: 'First consecutive stagnation — enrich the actor prompt with an explicit tried-approaches summary before spending on heavier remediation.' },
  { action: 'auto_debug', reason: 'Second consecutive stagnation — automatically engage the intelligent debugger to gather root-cause evidence.' },
  { action: 'speculative_branch', reason: 'Third consecutive stagnation — fan out into parallel speculative branches with diverse strategies.' },
  { action: 'targeted_hitl', reason: 'Fourth consecutive stagnation — escalate to a human, but with specific generated questions rather than an open-ended request.' },
  { action: 'full_escalation', reason: 'Fifth or more consecutive stagnation — full escalation with a synthesized summary of every attempt for human review.' },
];

export function computeLadderDecision(consecutiveStagnationCount: number): LadderDecision {
  if (consecutiveStagnationCount < 0) {
    throw new Error('computeLadderDecision: consecutiveStagnationCount must be >= 0');
  }
  const level = Math.min(consecutiveStagnationCount, LADDER.length - 1);
  return { level, ...LADDER[level]! };
}

/**
 * Level-1 response. Renders an explicit list of distinctly-tried approaches
 * so the actor can tell "tried and failed" apart from "never tried" — the
 * gap the original lossy, tail-truncated scratchpad left open.
 */
export function buildEnrichmentNote(triedApproaches: string[]): string {
  if (triedApproaches.length === 0) {
    return 'No prior approaches recorded yet for this stagnation point.';
  }
  const list = triedApproaches.map((a, i) => `${i + 1}. ${a}`).join('\n');
  return [
    `The following approaches have already been tried and did NOT resolve the failure:`,
    list,
    `Do not repeat any of these. Take a fundamentally different approach — a different library, a different layer of the stack, or a different root-cause hypothesis entirely.`,
  ].join('\n');
}
