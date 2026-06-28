import type { WorkflowState, WorkflowPhase } from './schemas.js';
import type { WorkflowConfig } from '../config/index.js';

export type EscalationReason =
  | 'budget_exceeded' | 'low_confidence' | 'max_cycles_reached'
  | 'all_branches_failed' | 'stagnation' | 'high_ambiguity_before_start'
  | 'suspected_test_fault' | 'test_fault_needs_human_approval'
  | 'baseline_tests_failing';

export interface SuccessTransition   { readonly nextPhase: Extract<WorkflowPhase,'MEMORY_CONSOLIDATION'>; readonly reason: 'all_tests_passed' }
export interface RetryTransition     { readonly nextPhase: Extract<WorkflowPhase,'ACTOR'|'INTELLIGENT_DEBUGGER'>; readonly reason: string; readonly diagnostic: string; readonly confidence: number }
export interface SpeculateTransition { readonly nextPhase: Extract<WorkflowPhase,'SPECULATIVE_BRANCH'>; readonly reason: string; readonly attempt: number }
export interface ReplanTransition    { readonly nextPhase: Extract<WorkflowPhase,'REPLAN'>; readonly reason: string; readonly attempt: number }
export interface EscalateTransition  { readonly nextPhase: Extract<WorkflowPhase,'HITL_ESCALATION'>; readonly reason: EscalationReason; readonly confidence: number|undefined; readonly cost: number|undefined }
export type VerifierTransition = SuccessTransition | RetryTransition | SpeculateTransition | ReplanTransition | EscalateTransition;

export function computeVerifierTransition(state: WorkflowState, config: WorkflowConfig): VerifierTransition {
  const verdict = state.verifierVerdict;
  const cycle   = state.correctionCycle;
  const cost    = state.cumulativeCostUsd;
  const conf    = state.confidenceScore;

  // PASS
  if (verdict?.testResult === 'PASS') {
    return { nextPhase: 'MEMORY_CONSOLIDATION', reason: 'all_tests_passed' };
  }

  // Hard stops first (cheapest checks)
  if (cost >= config.tokenBudget.criticalDollar) {
    return { nextPhase: 'HITL_ESCALATION', reason: 'budget_exceeded', confidence: conf, cost };
  }
  if (conf < config.confidenceEscalationThreshold) {
    return { nextPhase: 'HITL_ESCALATION', reason: 'low_confidence', confidence: conf, cost };
  }
  if (cycle.attemptCount >= config.maxSelfCorrectionCycles) {
    return { nextPhase: 'HITL_ESCALATION', reason: 'max_cycles_reached', confidence: conf, cost };
  }
  if (cycle.stagnationPattern !== 'none') {
    return { nextPhase: 'HITL_ESCALATION', reason: 'stagnation', confidence: conf, cost };
  }

  const diagnostic = verdict?.diagnostic ?? 'UNKNOWN';

  // AMBIGUOUS on first attempts → intelligent debugger
  if (diagnostic === 'AMBIGUOUS' && cycle.attemptCount <= 1) {
    return { nextPhase: 'INTELLIGENT_DEBUGGER', reason: 'ambiguous_routed_to_debugger', diagnostic, confidence: conf };
  }

  // Multiple failures with non-exhausted candidates → speculative branching
  const untriedCandidates = state.strategyCandidates.filter(c => !state.exhaustedBranches.includes(c.strategyId));
  if (cycle.attemptCount >= 2 && untriedCandidates.length > 0) {
    return { nextPhase: 'SPECULATIVE_BRANCH', reason: 'multiple_failures_trigger_speculation', attempt: cycle.attemptCount };
  }

  // All strategies exhausted → generate new ones via REPLAN
  if (
    cycle.attemptCount >= 2 &&
    state.strategyCandidates.filter(c => !state.exhaustedBranches.includes(c.strategyId)).length === 0
  ) {
    return { nextPhase: 'REPLAN', reason: 'all_strategies_exhausted', attempt: cycle.attemptCount };
  }

  return { nextPhase: 'ACTOR', reason: 'retry_with_feedback', diagnostic, confidence: conf };
}

export function computeConfidenceScore(state: WorkflowState, config: WorkflowConfig): number {
  let score = 1.0;
  score -= state.correctionCycle.attemptCount * 0.08;
  if (state.correctionCycle.stagnationPattern === 'semantic')  score -= 0.20;
  if (state.correctionCycle.stagnationPattern === 'iteration') score -= 0.15;
  if (state.correctionCycle.stagnationPattern === 'outcome')   score -= 0.25;
  score -= state.criticFindings.filter(f => f.severity === 'critical').length * 0.05;
  if (state.verifierVerdict?.diagnostic === 'AMBIGUOUS') score -= 0.15;
  const budgetFraction = state.cumulativeCostUsd / config.tokenBudget.criticalDollar;
  if (budgetFraction > 0.5) score -= (budgetFraction - 0.5) * 0.4;
  return Math.max(0, Math.min(1, score));
}

export const ALL_PHASES = [
  'BOOTSTRAP','SCOUT','FEASIBILITY_CHECK','VALUE_NODE','TDD_GATE','SANDBOX_VALIDATION',
  'ACTOR','PREFLIGHT','CRITICS','VERIFIER','FLAKINESS_CHECK','TEST_VALIDITY_REVIEW',
  'INTELLIGENT_DEBUGGER','REPLAN','SPECULATIVE_BRANCH','HITL_ESCALATION',
  'MEMORY_CONSOLIDATION','COMPLETE','FAILED',
] as const;
