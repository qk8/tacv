import {
  proxyActivities, defineSignal, defineQuery,
  setHandler, condition, log, executeChild, workflowInfo, CancellationScope,
} from '@temporalio/workflow';
import type { RegisteredActivities } from '../activities/registerActivities.js';
import type { TaskSpec, WorkflowState, LessonLearned } from '../state/schemas.js';
import { createInitialState, withPhase, withAuditEntry, withCost } from '../state/schemas.js';
import { computeVerifierTransition, computeConfidenceScore } from '../state/transitions.js';
import type { WorkflowConfig } from '../config/index.js';
import type { EscalationReason } from '../state/transitions.js';

export interface HumanDecision { action: 'approve'|'reject'|'override'; guidance: string }
export interface SpeculativeBranchResult {
  succeeded: boolean; winningState: Partial<WorkflowState> | null; attempts: number;
}

export const humanResumeSignal  = defineSignal<[HumanDecision]>('human.resume');
export const humanAbortSignal   = defineSignal<[{ reason: string }]>('human.abort');
export const workflowStateQuery = defineQuery<WorkflowState>('workflow.state');

// ── Proxy activity groups with differentiated timeouts ─────────────────────────
// Standard activities: 10-minute timeout, 3 retries
const {
  runBootstrap, runScout, runFeasibilityCheck, runValueNode, runTddGate,
  runSandboxValidation, runActor, runPreflight, runAllCritics,
  runFlakinessCheck, runTestValidityReview, runIntelligentDebugger, runReplan,
  runHitlEscalation, runMemoryConsolidation,
  // Redesign: new activities
  runBaselineVerification, runImplementationPlan, runGitCheckpoint,
  // Stagnation detection — pure computation, no I/O
  runStagnationCheck,
} = proxyActivities<RegisteredActivities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3, initialInterval: '2s', maximumInterval: '60s',
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['BudgetExceededError'],
  },
});

// Fast type-check: 2-minute timeout, 2 retries (cheap & quick)
const { runVerifierTypeCheck } = proxyActivities<RegisteredActivities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 2, initialInterval: '1s', backoffCoefficient: 2 },
});

// Test execution: 10-minute timeout, 2 retries
const { runVerifierTests } = proxyActivities<RegisteredActivities>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 2, initialInterval: '5s', backoffCoefficient: 2 },
});

// API tests: 5-minute timeout, 2 retries
const { runVerifierApi } = proxyActivities<RegisteredActivities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 2, initialInterval: '5s', backoffCoefficient: 2 },
});

// Mutation: 5-minute timeout, 1 retry only (expensive)
const { runVerifierMutation } = proxyActivities<RegisteredActivities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 1, initialInterval: '10s', backoffCoefficient: 2 },
});

// Visual: 10-minute timeout, 1 retry (environment-sensitive)
const { runVerifierVisual } = proxyActivities<RegisteredActivities>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 1, initialInterval: '10s', backoffCoefficient: 2 },
});

// ─────────────────────────────────────────────────────────────────────────────

export async function CodingWorkflow(task: TaskSpec, config: WorkflowConfig): Promise<LessonLearned | null> {
  let state   = createInitialState(task, workflowInfo().workflowId);
  let human:  HumanDecision | null = null;
  let aborted = false;
  let correctionScope: CancellationScope | null = null;

  setHandler(workflowStateQuery, () => state);
  setHandler(humanResumeSignal, (d) => { human = d; });
  setHandler(humanAbortSignal, ({ reason }) => {
    log.warn('workflow.aborted', { reason });
    aborted = true;
    if (correctionScope) correctionScope.cancel();
  });

  // ── Setup phases ──────────────────────────────────────────────────────────
  state = await runBootstrap(state);
  state = await runScout(state);

  // ★ REDESIGN: Baseline verification — verify tests pass BEFORE touching code
  // This prevents the agent from burning budget on pre-existing failures it didn't cause.
  state = await runBaselineVerification(state);
  if (state.currentPhase === 'HITL_ESCALATION') {
    log.warn('workflow.baseline_failed_hitl', {
      hint: 'Tests were already failing before agent started — fix baseline first',
    });
    state = await runHitlEscalation(state, 'baseline_tests_failing');
    const received = await condition(() => human !== null || aborted, config.hitl.waitTimeout);
    const hd = human as HumanDecision | null;
    if (!received || aborted || hd?.action === 'reject') return null;
    if (hd?.action === 'override' && hd.guidance) {
      state = { ...state, agentsMdContext: hd.guidance, hitlPriorGuidance: hd.guidance };
    }
    if (hd) human = null;
  }

  // Feasibility check (escalate early on ambiguous/high-risk tasks)
  state = await runFeasibilityCheck(state);
  if (state.currentPhase === 'HITL_ESCALATION') {
    state = await runHitlEscalation(state, 'high_ambiguity_before_start');
    const received = await condition(() => human !== null || aborted, config.hitl.waitTimeout);
    const hd = human as HumanDecision | null;
    if (!received || aborted || hd?.action === 'reject') {
      state = withPhase(state, 'FAILED');
      return null;
    }
    if (hd) {
      if (hd.action === 'override' && hd.guidance) {
        state = { ...state, agentsMdContext: hd.guidance, hitlPriorGuidance: hd.guidance };
      }
      human = null;
    }
    state = withPhase(state, 'VALUE_NODE');
  }

  state = await runValueNode(state);

  // ★ REDESIGN: Implementation planning — agent plans before coding
  // Critics validate the plan structure BEFORE any code is written.
  state = await runImplementationPlan(state);

  if (!config.skipTddGate) state = await runTddGate(state);

  if (state.currentPhase === 'SANDBOX_VALIDATION') {
    state = await runSandboxValidation(state);
  }

  // ── Correction loop (with cancellation scope for graceful abort) ──────────
  correctionScope = new CancellationScope();
  correctionScope.onCancel(() => { log.info('workflow.correction_loop_cancelled'); });
  try {
    await correctionScope.child(async () => {
      for (let i = 0; i < config.maxSelfCorrectionCycles && !aborted; i++) {
    state = withAuditEntry(state, {
      node: 'correction_loop', decision: `cycle_start_${i}`,
      keyValues: { cycle: i, cost: state.cumulativeCostUsd },
    });

    state = await runActor(state);
    state = await runPreflight(state);

    // ★ REDESIGN: Split critics — fast lane always, semantic lane deferred
    // allCriticsImpl internally applies the deferral config from criticLanes
    state = await runAllCritics(state);

    // ★ REDESIGN: Staged verifier — 5 activities with independent retry/timeout
    // Short-circuits: each stage skips if the previous set a FAIL verdict.
    if (state.verifierVerdict?.blockedByCritic !== true) {
      state = await runVerifierTypeCheck(state);
      state = await runVerifierTests(state);
      state = await runVerifierApi(state);
      state = await runVerifierMutation(state);
      state = await runVerifierVisual(state);
    }

    // Flakiness check on first fail to avoid blaming correct code
    if (state.verifierVerdict?.testResult === 'FAIL' && state.correctionCycle.attemptCount >= 1) {
      state = await runFlakinessCheck(state);
      if (state.flakinessReport && state.flakinessReport.flakyTests.length > 0) {
        log.warn('workflow.flakiness_detected', { count: state.flakinessReport.flakyTests.length });
        state = withAuditEntry(state, { node: 'flakiness_routing', decision: 'flaky_tests_back_to_actor', keyValues: { tests: state.flakinessReport.flakyTests } });
        continue;
      }

      // Test validity review — check if failures are test faults vs. impl faults
      // Runs after flakiness is ruled out, starting at cycle >= config.testValidity.triggerAfterCycles
      if (config.testValidity.enabled && state.correctionCycle.attemptCount >= config.testValidity.triggerAfterCycles) {
        state = await runTestValidityReview(state);
        if (state.currentPhase === 'HITL_ESCALATION') {
          log.warn('workflow.test_fault_detected', {
            tests: state.testValidityFlag?.affectedTests,
            confidence: state.testValidityFlag?.confidence,
          });
          state = await runHitlEscalation(state, 'test_fault_needs_human_approval');
          const received = await condition(() => human !== null || aborted, config.hitl.waitTimeout);
          const hd = human as HumanDecision | null;
          if (!received || aborted || hd?.action === 'reject') { state = withPhase(state, 'FAILED'); break; }
          if (hd?.action === 'override' && hd.guidance) {
            state = { ...state, agentsMdContext: hd.guidance, hitlPriorGuidance: hd.guidance };
          }
          human = null;
          state = withPhase(state, 'ACTOR');
          continue;
        }
      }
    }

    // ★ REDESIGN: Git checkpoint after every verifier PASS
    // Enables true rollback and speculative branches that fork from a clean commit.
    if (state.verifierVerdict?.testResult === 'PASS') {
      state = await runGitCheckpoint(state);
    }

    // Update stagnation state — compare current failure hash to history
    // before the transition logic reads stagnationPattern to decide routing.
    state = await runStagnationCheck(state);

    // Recompute confidence score after all cycle phases have run.
    // The score computed in actorImpl is stale — it doesn't reflect
    // critic findings, verifier verdict, or the updated stagnation pattern.
    state = { ...state, confidenceScore: computeConfidenceScore(state, config) };

    // Compute routing transition
    const transition = computeVerifierTransition(state, config);
    log.info('workflow.transition', {
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
      const received = await condition(() => human !== null || aborted, config.hitl.waitTimeout);
      const hd = human as HumanDecision | null;
      if (!received || aborted || hd?.action === 'reject') { state = withPhase(state, 'FAILED'); break; }

      const budgetAtEsc     = state.hitlBudgetAtEscalation ?? state.cumulativeCostUsd;
      const budgetRemaining = config.tokenBudget.criticalDollar - budgetAtEsc;
      if (budgetRemaining < config.tokenBudget.criticalDollar * 0.15) {
        log.warn('workflow.hitl_budget_too_low_for_resume', { budgetRemaining });
        state = withPhase(state, 'FAILED'); break;
      }

      if (hd) {
        if (hd.action === 'override' && hd.guidance) {
          state = { ...state, agentsMdContext: hd.guidance, hitlPriorGuidance: hd.guidance };
        }
        human = null;
      }
      state = withPhase(state, 'ACTOR');
      continue;
    }

    if (transition.nextPhase === 'INTELLIGENT_DEBUGGER') {
      state = await runIntelligentDebugger(state); continue;
    }

    if (transition.nextPhase === 'SPECULATIVE_BRANCH') {
      // ★ REDESIGN: True parallel speculative branches using Promise.allSettled
      // Each candidate gets its own child workflow executed concurrently.
      // Original TACV bug: used sequential for-loop (not parallel at all).
      state = _diversifyStrategyCandidates(state);
      const candidates = state.strategyCandidates
        .filter(c => !state.exhaustedBranches.includes(c.strategyId))
        .slice(0, config.maxParallelBranches);

      log.info('workflow.speculative_branch_start', {
        branches: candidates.length,
        // ★ REDESIGN: Each branch has its own git starting point from checkpoint
        gitBase: state.gitCheckpoint?.commitHash ?? 'dirty-tree',
      });

      const branchResults = await Promise.allSettled(
        candidates.map((candidate, idx) =>
          executeChild(SpeculativeBranchWorkflow, {
            args: [{ ...state, selectedStrategy: candidate }, config],
            taskQueue: workflowInfo().taskQueue,
            workflowExecutionTimeout: '20 minutes',
            // Unique workflow ID for Temporal Web UI visibility
            workflowId: `${workflowInfo().workflowId}-branch-${idx}-${candidate.strategyId}`,
          })
        )
      );

      // Take the first successful branch
      const winner = branchResults
        .filter((r): r is PromiseFulfilledResult<SpeculativeBranchResult> => r.status === 'fulfilled')
        .map(r => r.value)
        .find(r => r.succeeded && r.winningState);

      if (winner?.winningState) {
        state = { ...state, ...winner.winningState };
        log.info('workflow.speculative_winner', { strategies: candidates.length });
        break;
      }

      log.warn('workflow.speculative_all_failed', { branches: candidates.length });
      // Mark all attempted candidates as exhausted so they are not retried
      state = {
        ...state,
        exhaustedBranches: [
          ...state.exhaustedBranches,
          ...candidates.map(c => c.strategyId),
        ],
      };
      state = withPhase(state, 'HITL_ESCALATION');
      continue;
    }

    if (transition.nextPhase === 'REPLAN') { state = await runReplan(state); continue; }
    // default: ACTOR retry
      }
    });
  } catch (err) {
    // Cancellation scope was cancelled — in-flight activities were aborted
    if (aborted) {
      log.info('workflow.correction_loop_aborted', { error: String(err) });
      return null;
    }
    throw err;
  }

  if (state.currentPhase !== 'FAILED' && !aborted) {
    state = await runMemoryConsolidation(state);
  }
  return state.lessonLearned;
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ REDESIGN: Single-strategy child workflow (replaces the sequential for-loop)
//
// Original TACV bug: SpeculativeBranchWorkflow iterated candidates in a for-loop,
// which was SEQUENTIAL, not parallel. The README said "parallel" but the
// implementation was serial — branches took 3× as long for 3 candidates.
//
// Fix: the PARENT (CodingWorkflow) now launches ONE child per candidate via
// Promise.allSettled. This workflow handles exactly ONE strategy.
// ─────────────────────────────────────────────────────────────────────────────
export async function SpeculativeBranchWorkflow(
  parentState: WorkflowState,
  _config:     WorkflowConfig,
): Promise<SpeculativeBranchResult> {
  const {
    runActor, runPreflight, runAllCritics,
    runVerifierTypeCheck, runVerifierTests, runVerifierApi,
    runVerifierMutation, runVerifierVisual,
  } = proxyActivities<RegisteredActivities>({
    startToCloseTimeout: '10 minutes',
    retry: { maximumAttempts: 2 },
  });

  const candidate = parentState.selectedStrategy;
  if (!candidate) {
    log.warn('speculative.no_candidate');
    return { succeeded: false, winningState: null, attempts: 1 };
  }

  log.info('speculative.branch_start', { strategyId: candidate.strategyId });

  try {
    let s = parentState;
    s = await runActor(s);
    s = await runPreflight(s);
    s = await runAllCritics(s);
    // Use staged verifier even in speculative branches
    if (s.verifierVerdict?.blockedByCritic !== true) {
      s = await runVerifierTypeCheck(s);
      s = await runVerifierTests(s);
      s = await runVerifierApi(s);
      s = await runVerifierMutation(s);
      s = await runVerifierVisual(s);
    }
    if (s.verifierVerdict?.testResult === 'PASS') {
      log.info('speculative.branch_passed', { strategyId: candidate.strategyId });
      return { succeeded: true, winningState: s, attempts: 1 };
    }
  } catch (err) {
    log.warn('speculative.branch_failed', { strategyId: candidate.strategyId, error: String(err) });
  }

  return { succeeded: false, winningState: null, attempts: 1 };
}

export async function ShadowModeWorkflow(ctx: { repoPath: string; maxTasks: number }): Promise<void> {
  const { runShadowCycle } = proxyActivities<RegisteredActivities>({
    startToCloseTimeout: '20 minutes', retry: { maximumAttempts: 2 },
  });
  await runShadowCycle(ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function _diversifyStrategyCandidates(state: WorkflowState): WorkflowState {
  const active = state.strategyCandidates.filter(c => !state.exhaustedBranches.includes(c.strategyId));
  if (active.length < 2) return state;
  const descriptions = active.map(c => c.description);
  // Rebuild the FULL candidates list: only inject avoidHint on active ones
  const updatedCandidates = state.strategyCandidates.map(c => {
    const isActive = active.some(a => a.strategyId === c.strategyId);
    if (!isActive) return c; // exhausted — preserve as-is
    const othersDesc = descriptions.filter(d => d !== c.description).join('; ');
    return {
      ...c,
      avoidHint: `Do NOT use these approaches (already being tried by other branches): ${
        othersDesc
      }. Try a fundamentally different solution — if others add code, consider removing or restructuring instead.`,
    };
  });
  return { ...state, strategyCandidates: updatedCandidates };
}
