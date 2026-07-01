/**
 * Targeted HITL question generation.
 *
 * ── Problem this replaces ───────────────────────────────────────────────────
 * `hitlImpl` escalates with a task description, an `EscalationReason` code,
 * and (optionally) the audit trail. The human is asked to respond with
 * `approve | reject | override` plus free-text `guidance`. Reconstructing
 * what was actually tried means reading the audit trail by hand, and
 * "override with guidance" is too open-ended to reliably produce something
 * the agent can act on — a human typing "add better error handling" doesn't
 * help when the real problem is a missing JWT signing key configuration.
 *
 * ── What this module provides ───────────────────────────────────────────────
 * `generateTargetedQuestion` maps `(escalationReason, errorType, stagnation
 * context)` onto a structured question: a synthesized one-line summary of
 * what was tried, a specific question, and 2-4 concrete options. Each option
 * still carries an `actionHint` (`approve | reject | override`) and a
 * `guidanceTemplate`, so the result is fully compatible with the existing
 * `HumanDecision` signal contract in `CodingWorkflow.ts` — this is additive,
 * not a breaking change to the HITL signal shape. A UI can render the
 * options as buttons; selecting one yields a valid `HumanDecision` without
 * the human ever typing free text, while still allowing free text to refine
 * `guidanceTemplate` if they want to.
 */

import type { EscalationReason } from '../../state/transitions.js';
import type { ErrorType } from '../../state/schemas.js';

export interface HitlOption {
  readonly id: string;
  readonly label: string;
  readonly actionHint: 'approve' | 'reject' | 'override';
  readonly guidanceTemplate: string;
}

export interface HitlQuestion {
  readonly summary: string;
  readonly question: string;
  readonly options: HitlOption[];
}

export interface TargetedQuestionInput {
  readonly reason: EscalationReason;
  readonly errorType?: ErrorType | null;
  readonly triedApproaches: string[];
  readonly affectedTests?: string[];
  readonly cost?: number;
}

function summarizeTried(triedApproaches: string[]): string {
  if (triedApproaches.length === 0) return 'No prior approaches recorded.';
  return `${triedApproaches.length} approach(es) already attempted: ${triedApproaches.join('; ')}.`;
}

const BEAN_CREATION_QUESTION =
  'The agent is stuck on a Spring bean creation / dependency injection error. Is there a missing bean definition, ' +
  'a circular dependency, or a profile/configuration issue the agent cannot see from inside the sandbox?';

const STAGNATION_ERROR_TYPE_QUESTIONS: Partial<Record<ErrorType, string>> = {
  BEAN_CREATION_ERROR: BEAN_CREATION_QUESTION,
  VALIDATION_ERROR: 'The agent keeps hitting a validation error it cannot resolve. Is there a business rule or constraint that is not documented in the task description?',
  TIMEOUT: 'The agent keeps hitting timeouts. Is there an external dependency (service, database, network policy) in this environment the agent does not have visibility into?',
  OUT_OF_MEMORY: 'The agent keeps hitting out-of-memory failures. Is there a known data-volume or resource constraint for this environment the agent should account for?',
};

function buildStagnationQuestion(input: TargetedQuestionInput): HitlQuestion {
  const specific = input.errorType ? STAGNATION_ERROR_TYPE_QUESTIONS[input.errorType] : undefined;
  const question = specific ?? 'The agent has stagnated on the same class of failure across multiple cycles. What additional context can resolve it?';
  return {
    summary: summarizeTried(input.triedApproaches),
    question,
    options: [
      { id: 'provide_context', label: 'Provide missing context/config', actionHint: 'override', guidanceTemplate: 'Here is the missing context: ' },
      { id: 'different_strategy', label: 'Direct the agent to a different strategy', actionHint: 'override', guidanceTemplate: 'Try this fundamentally different approach instead: ' },
      { id: 'abort_task', label: 'Abort this task', actionHint: 'reject', guidanceTemplate: 'Aborting — will revisit manually.' },
    ],
  };
}

function buildBaselineQuestion(): HitlQuestion {
  return {
    summary: 'The protection test suite was already failing before the agent made any changes.',
    question: 'The baseline test suite is failing independently of the agent\'s work. Should the agent fix the baseline first, proceed despite it, or should this be handled separately?',
    options: [
      { id: 'fix_baseline', label: 'Have the agent fix the baseline first', actionHint: 'override', guidanceTemplate: 'Fix the pre-existing baseline failures before proceeding with the task.' },
      { id: 'proceed_anyway', label: 'Proceed despite the broken baseline', actionHint: 'override', guidanceTemplate: 'The baseline failures are known and out of scope — proceed with the task and ignore them.' },
      { id: 'abort', label: 'Abort — handle the baseline separately', actionHint: 'reject', guidanceTemplate: 'Aborting until the baseline is fixed out-of-band.' },
    ],
  };
}

function buildBudgetQuestion(input: TargetedQuestionInput): HitlQuestion {
  const costStr = input.cost != null ? `$${input.cost}` : 'the configured limit';
  return {
    summary: summarizeTried(input.triedApproaches),
    question: `The task has spent ${costStr}, exceeding the budget limit. Extend the budget, accept the current state, or abort?`,
    options: [
      { id: 'extend_budget', label: 'Extend the budget and continue', actionHint: 'override', guidanceTemplate: 'Budget extended — continue working on the task.' },
      { id: 'accept_current', label: 'Accept the current (incomplete) state', actionHint: 'approve', guidanceTemplate: 'Accepting current state as final.' },
      { id: 'abort', label: 'Abort the task', actionHint: 'reject', guidanceTemplate: 'Aborting due to budget.' },
    ],
  };
}

function buildTestFaultQuestion(input: TargetedQuestionInput): HitlQuestion {
  const testsList = input.affectedTests?.length ? input.affectedTests.join(', ') : 'unspecified tests';
  return {
    summary: `Suspected test fault affecting: ${testsList}. ${summarizeTried(input.triedApproaches)}`,
    question: 'The verifier suspects the failing tests themselves may be wrong rather than the implementation. Are the tests correct (fix the implementation) or are the tests wrong (approve a test fix)?',
    options: [
      { id: 'tests_correct', label: 'Tests are correct — keep fixing the implementation', actionHint: 'override', guidanceTemplate: 'The tests are correct as written. Keep iterating on the implementation.' },
      { id: 'tests_wrong', label: 'Tests are wrong — approve the proposed test fix', actionHint: 'approve', guidanceTemplate: 'Approved — the proposed test changes are correct.' },
      { id: 'need_more_info', label: 'Need more investigation before deciding', actionHint: 'reject', guidanceTemplate: 'Pausing for manual investigation.' },
    ],
  };
}

function buildAmbiguityQuestion(): HitlQuestion {
  return {
    summary: 'The task description was flagged as highly ambiguous before any code was written.',
    question: 'The task requirements are ambiguous enough that the agent flagged them before starting. Can you clarify the requirement, or should a specific interpretation be assumed?',
    options: [
      { id: 'clarify', label: 'Clarify the requirement', actionHint: 'override', guidanceTemplate: 'Clarification: ' },
      { id: 'assume_simplest', label: 'Assume the simplest reasonable interpretation', actionHint: 'override', guidanceTemplate: 'Proceed with the simplest reasonable interpretation of the task.' },
      { id: 'abort', label: 'Abort until requirements are written up', actionHint: 'reject', guidanceTemplate: 'Aborting pending clearer requirements.' },
    ],
  };
}

function buildMaxCyclesQuestion(input: TargetedQuestionInput): HitlQuestion {
  return {
    summary: summarizeTried(input.triedApproaches),
    question: 'The maximum number of self-correction cycles was reached without success. Extend the cycle limit, accept the current state, or abort?',
    options: [
      { id: 'extend_cycles', label: 'Extend the cycle limit and continue', actionHint: 'override', guidanceTemplate: 'Cycle limit extended — continue working on the task.' },
      { id: 'accept_current', label: 'Accept the current (incomplete) state', actionHint: 'approve', guidanceTemplate: 'Accepting current state as final.' },
      { id: 'abort', label: 'Abort the task', actionHint: 'reject', guidanceTemplate: 'Aborting after max cycles.' },
    ],
  };
}

function buildAllBranchesFailedQuestion(input: TargetedQuestionInput): HitlQuestion {
  return {
    summary: summarizeTried(input.triedApproaches),
    question: 'Every speculative branch (diverse strategy) failed. Provide a new strategic direction, accept partial progress, or abort?',
    options: [
      { id: 'new_direction', label: 'Provide a new strategic direction', actionHint: 'override', guidanceTemplate: 'Try this direction instead: ' },
      { id: 'accept_partial', label: 'Accept the best partial result obtained so far', actionHint: 'approve', guidanceTemplate: 'Accepting partial progress as final.' },
      { id: 'abort', label: 'Abort the task', actionHint: 'reject', guidanceTemplate: 'Aborting — all strategies exhausted.' },
    ],
  };
}

function buildLowConfidenceQuestion(input: TargetedQuestionInput): HitlQuestion {
  return {
    summary: summarizeTried(input.triedApproaches),
    question: 'The agent\'s confidence score dropped below the safety threshold. Continue with guidance, accept current state, or abort?',
    options: [
      { id: 'continue_guided', label: 'Continue with additional guidance', actionHint: 'override', guidanceTemplate: 'Additional guidance: ' },
      { id: 'accept_current', label: 'Accept the current state', actionHint: 'approve', guidanceTemplate: 'Accepting current state as final.' },
      { id: 'abort', label: 'Abort the task', actionHint: 'reject', guidanceTemplate: 'Aborting due to low confidence.' },
    ],
  };
}

export function generateTargetedQuestion(input: TargetedQuestionInput): HitlQuestion {
  switch (input.reason) {
    case 'baseline_tests_failing': return buildBaselineQuestion();
    case 'budget_exceeded': return buildBudgetQuestion(input);
    case 'suspected_test_fault':
    case 'test_fault_needs_human_approval': return buildTestFaultQuestion(input);
    case 'high_ambiguity_before_start': return buildAmbiguityQuestion();
    case 'max_cycles_reached': return buildMaxCyclesQuestion(input);
    case 'all_branches_failed': return buildAllBranchesFailedQuestion(input);
    case 'low_confidence': return buildLowConfidenceQuestion(input);
    case 'stagnation': return buildStagnationQuestion(input);
    default: {
      // Exhaustiveness guard: if a new EscalationReason is ever added without
      // updating this module, fail loudly in tests/CI rather than silently
      // falling back to a useless generic wall.
      const _exhaustive: never = input.reason;
      throw new Error(`generateTargetedQuestion: no template for escalation reason "${String(_exhaustive)}"`);
    }
  }
}

export function formatQuestionForDisplay(q: HitlQuestion): string {
  const optionLines = q.options.map((o, i) => `  ${i + 1}. ${o.label}`).join('\n');
  return `${q.summary}\n\n${q.question}\n\nOptions:\n${optionLines}`;
}
