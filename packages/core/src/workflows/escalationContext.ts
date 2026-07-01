/**
 * Builds the full context attached to every HITL escalation: a synthesized
 * root-cause summary (from `activities/critics/synthesis.ts`) and a
 * failure-mode-specific structured question (from
 * `activities/hitl/questionGenerator.ts`). This is the single seam
 * `CodingWorkflowV2` calls at every `runHitlEscalation` site, so a human
 * reviewing any escalation sees compressed root causes and a concrete
 * question instead of a raw finding dump and a bare reason code.
 */

import type { WorkflowState } from '../state/schemas.js';
import type { EscalationReason } from '../state/transitions.js';
import { synthesizeFindings, formatRootCausesForActor } from '../activities/critics/synthesis.js';
import { generateTargetedQuestion, type HitlQuestion } from '../activities/hitl/questionGenerator.js';

export interface EscalationContext {
  readonly rootCauseSummary: string;
  readonly targetedQuestion: HitlQuestion;
}

/** The actor's scratchpad accumulates one line per cycle (see `actor/impl.ts`); each line is a distinct tried approach. */
function extractTriedApproaches(state: WorkflowState): string[] {
  if (!state.sessionScratchpad) return [];
  return state.sessionScratchpad.split('\n').map(l => l.trim()).filter(Boolean);
}

export function buildEscalationContext(state: WorkflowState, reason: EscalationReason): EscalationContext {
  const rootCauseSummary = formatRootCausesForActor(synthesizeFindings(state.criticFindings));
  const triedApproaches = extractTriedApproaches(state);

  const targetedQuestion = generateTargetedQuestion({
    reason,
    errorType: state.debugObservations?.errorType ?? null,
    triedApproaches,
    cost: state.cumulativeCostUsd,
    ...(state.testValidityFlag?.affectedTests ? { affectedTests: state.testValidityFlag.affectedTests } : {}),
  });

  return { rootCauseSummary, targetedQuestion };
}
