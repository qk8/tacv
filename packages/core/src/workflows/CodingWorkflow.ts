import {
  proxyActivities, defineSignal, defineQuery,
  setHandler, condition, log, executeChild, workflowInfo,
} from '@temporalio/workflow';
import type { RegisteredActivities } from '../activities/registerActivities.js';
import type { TaskSpec, WorkflowState, LessonLearned } from '../state/schemas.js';
import { createInitialState, withPhase, withAuditEntry, withCost } from '../state/schemas.js';
import { computeVerifierTransition } from '../state/transitions.js';
import type { WorkflowConfig } from '../config/index.js';
import type { EscalationReason } from '../state/transitions.js';

export interface HumanDecision { action: 'approve'|'reject'|'override'; guidance: string }
export interface SpeculativeBranchResult {
  succeeded: boolean; winningState: Partial<WorkflowState> | null; attempts: number;
}

export const humanResumeSignal  = defineSignal<[HumanDecision]>('human.resume');
export const humanAbortSignal   = defineSignal<[{ reason: string }]>('human.abort');
export const workflowStateQuery = defineQuery<WorkflowState>('workflow.state');

const {
  runBootstrap, runScout, runFeasibilityCheck, runValueNode, runTddGate,
  runSandboxValidation, runActor, runPreflight, runAllCritics, runVerifier,
  runFlakinessCheck, runTestValidityReview, runIntelligentDebugger, runReplan,
  runHitlEscalation, runMemoryConsolidation,
} = proxyActivities<RegisteredActivities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3, initialInterval: '2s', maximumInterval: '60s',
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['BudgetExceededError'],
  },
});

export async function CodingWorkflow(task: TaskSpec, config: WorkflowConfig): Promise<LessonLearned | null> {
  let state   = createInitialState(task);
  let human:  HumanDecision | null = null;
  let aborted = false;

  setHandler(workflowStateQuery, () => state);
  setHandler(humanResumeSignal, (d) => { human = d; });
  setHandler(humanAbortSignal, ({ reason }) => { log.warn('workflow.aborted', { reason }); aborted = true; });

  // ── Linear setup phases ───────────────────────────────────────────────────
  state = await runBootstrap(state);
  state = await runScout(state);

  // FIX 11: Feasibility check before spending budget
  state = await runFeasibilityCheck(state);
  if (state.currentPhase === 'HITL_ESCALATION') {
    state = await _handleHitl(state, 'high_ambiguity_before_start', config, human, aborted, runHitlEscalation);
    if (state.currentPhase === 'FAILED') return null;
    human = null;
  }

  state = await runValueNode(state);
  state = await runTddGate(state);

  // FIX 7 (sandbox validation only in GREENFIELD — BROWNFIELD skips to ACTOR in tddGate)
  if (state.currentPhase === 'SANDBOX_VALIDATION') {
    state = await runSandboxValidation(state);
  }

  // ── Correction loop ───────────────────────────────────────────────────────
  for (let i = 0; i < config.maxSelfCorrectionCycles && !aborted; i++) {
    state = await runActor(state);
    state = await runPreflight(state);
    state = await runAllCritics(state);
    state = await runVerifier(state);

    // FIX 4: Flakiness check — detect non-deterministic tests before drawing conclusions
    if (state.verifierVerdict?.testResult === 'FAIL' && state.correctionCycle.attemptCount >= 1) {
      state = await runFlakinessCheck(state);
      if (state.flakinessReport && state.flakinessReport.flakyTests.length > 0) {
        log.warn('workflow.flakiness_detected', { count: state.flakinessReport.flakyTests.length });
        // Flakiness doesn't auto-escalate — route back to actor to fix the tests
        state = withAuditEntry(state, { node: 'flakiness_routing', decision: 'flaky_tests_back_to_actor', keyValues: { tests: state.flakinessReport.flakyTests } });
        continue;
      }
    }

    // FIX 3: Test validity review — check if the test itself is wrong
    if (state.verifierVerdict?.testResult === 'FAIL' &&
        state.correctionCycle.attemptCount >= config.testValidity.triggerAfterCycles) {
      state = await runTestValidityReview(state);
      if (state.currentPhase === 'HITL_ESCALATION') {
        // Test fault detected — escalate for human review
        state = await runHitlEscalation(state, 'suspected_test_fault');
        const received = await condition(() => human !== null || aborted, '48 hours');
        if (!received || aborted || human?.action === 'reject') {
          state = withPhase(state, 'FAILED'); break;
        }
        if (human?.action === 'override' && human.guidance) {
          // Human approved test fix — inject guidance and continue
          state = { ...state, agentsMdContext: human.guidance, currentPhase: 'ACTOR' };
          human = null; continue;
        }
        human = null; continue;
      }
    }

    const transition = computeVerifierTransition(state, config);

    log.info('workflow.routing', {
      from: state.currentPhase, to: transition.nextPhase, reason: transition.reason,
      confidence: 'confidence' in transition ? transition.confidence : undefined,
      attempt: state.correctionCycle.attemptCount,
    });

    state = withAuditEntry(state, {
      node: 'verifier_routing',
      decision: `→${transition.nextPhase} (${transition.reason})`,
      keyValues: transition as unknown as Record<string, unknown>,
    });

    if (transition.nextPhase === 'MEMORY_CONSOLIDATION') break;

    if (transition.nextPhase === 'HITL_ESCALATION') {
      state = await runHitlEscalation(state, transition.reason);
      const received = await condition(() => human !== null || aborted, '48 hours');
      if (!received || aborted || human?.action === 'reject') { state = withPhase(state, 'FAILED'); break; }

      // FIX 10: Check budget at escalation — if too low, don't resume
      const budgetAtEsc    = state.hitlBudgetAtEscalation ?? state.cumulativeCostUsd;
      const budgetRemaining = config.tokenBudget.criticalDollar - budgetAtEsc;
      if (budgetRemaining < config.tokenBudget.criticalDollar * 0.15) {
        log.warn('workflow.hitl_budget_too_low_for_resume', { budgetRemaining, hint: 'Start a fresh session' });
        state = withPhase(state, 'FAILED'); break;
      }

      if (human?.action === 'override' && human.guidance) {
        // FIX 10: Store prior guidance so next HITL shows what was already tried
        state = { ...state, agentsMdContext: human.guidance, hitlPriorGuidance: human.guidance };
      }
      human = null;
      state = withPhase(state, 'ACTOR');
      continue;
    }

    if (transition.nextPhase === 'INTELLIGENT_DEBUGGER') {
      state = await runIntelligentDebugger(state); continue;
    }

    if (transition.nextPhase === 'SPECULATIVE_BRANCH') {
      // FIX 9: Force diversity in branches
      state = _diversifyStrategyCandidates(state);
      const result = await executeChild(SpeculativeBranchWorkflow, {
        args: [state, config], taskQueue: workflowInfo().taskQueue,
        workflowExecutionTimeout: '30 minutes',
      }) as SpeculativeBranchResult;
      if (result.succeeded && result.winningState) { state = { ...state, ...result.winningState }; break; }
      state = withPhase(state, 'HITL_ESCALATION');
      continue;
    }

    if (transition.nextPhase === 'REPLAN') { state = await runReplan(state); continue; }
    // default: ACTOR retry
  }

  if (state.currentPhase !== 'FAILED' && !aborted) {
    state = await runMemoryConsolidation(state);
  }
  return state.lessonLearned;
}

/** FIX 9: Inject diversity hints so speculative branches don't all try the same approach */
function _diversifyStrategyCandidates(state: WorkflowState): WorkflowState {
  const candidates = state.strategyCandidates.filter(c => !state.exhaustedBranches.includes(c.strategyId));
  if (candidates.length < 2) return state;
  const descriptions = candidates.map(c => c.description);
  const diversified = candidates.map((c, idx) => ({
    ...c,
    avoidHint: `Do NOT use these approaches (already being tried by other branches): ${
      descriptions.filter((_, i) => i !== idx).join('; ')
    }. Try a fundamentally different solution — if others add code, consider removing or restructuring instead.`,
  }));
  return { ...state, strategyCandidates: diversified };
}

async function _handleHitl(
  state:    WorkflowState, reason: EscalationReason, _config: WorkflowConfig,
  human:    HumanDecision | null, aborted: boolean,
  runHitl:  (s: WorkflowState, r: EscalationReason) => Promise<WorkflowState>,
): Promise<WorkflowState> {
  const s = await runHitl(state, reason);
  if (aborted || human?.action === 'reject') return withPhase(s, 'FAILED');
  return s;
}

// ── Speculative Branch Child Workflow ─────────────────────────────────────────
export async function SpeculativeBranchWorkflow(parentState: WorkflowState, config: WorkflowConfig): Promise<SpeculativeBranchResult> {
  const { runActor, runPreflight, runAllCritics, runVerifier } =
    proxyActivities<RegisteredActivities>({ startToCloseTimeout: '10 minutes', retry: { maximumAttempts: 2 } });

  const candidates = parentState.strategyCandidates
    .filter(c => !parentState.exhaustedBranches.includes(c.strategyId))
    .slice(0, config.maxParallelBranches);

  log.info('speculative.start', { branches: candidates.length });

  for (const candidate of candidates) {
    let s = { ...parentState, selectedStrategy: candidate };
    try {
      s = await runActor(s);
      s = await runPreflight(s);
      s = await runAllCritics(s);
      s = await runVerifier(s);
      if (s.verifierVerdict?.testResult === 'PASS') {
        log.info('speculative.winner', { strategyId: candidate.strategyId });
        return { succeeded: true, winningState: s, attempts: candidates.length };
      }
    } catch (err) {
      log.warn('speculative.branch_failed', { strategyId: candidate.strategyId, error: String(err) });
    }
  }
  return { succeeded: false, winningState: null, attempts: candidates.length };
}

export async function ShadowModeWorkflow(ctx: { repoPath: string; maxTasks: number }): Promise<void> {
  const { runShadowCycle } = proxyActivities<RegisteredActivities>({
    startToCloseTimeout: '20 minutes', retry: { maximumAttempts: 2 },
  });
  await runShadowCycle(ctx);
}
