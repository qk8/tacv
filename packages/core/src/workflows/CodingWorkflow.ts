import {
  proxyActivities, defineSignal, defineQuery,
  setHandler, condition, log, executeChild, workflowInfo, CancellationScope, sleep,
} from '@temporalio/workflow';
import type { RegisteredActivities }           from '../activities/registerActivities.js';
import type { TaskSpec, WorkflowState, LessonLearned, DiffEntry } from '../state/schemas.js';
import { createInitialState, withPhase, withAuditEntry, withCost } from '../state/schemas.js';
import { computeVerifierTransition, computeConfidenceScore } from '../state/transitions.js';
import type { WorkflowConfig }                 from '../config/index.js';
import type { EscalationReason }               from '../state/transitions.js';

// ★ V2 redesign imports — all new modules built and tested this session
import { TaskGraph }                           from '../planning/graph.js';
import { trackConsecutiveStagnation, computeLadderDecision } from '../activities/stagnation/ladder.js';
import { buildSpeculativeBranchStates }        from './speculativeBranching.js';
import { buildEscalationContext }              from './escalationContext.js';

export interface HumanDecision { action: 'approve'|'reject'|'override'; guidance: string }
export interface SpeculativeBranchResult {
  succeeded: boolean; winningState: Partial<WorkflowState> | null; attempts: number;
  hadFlakiness?: boolean;
}

export const humanResumeSignal  = defineSignal<[HumanDecision]>('human.resume');
export const humanAbortSignal   = defineSignal<[{ reason: string }]>('human.abort');
export const workflowStateQuery = defineQuery<WorkflowState>('workflow.state');

export interface WorkflowProgressResult {
  phase: string; cycle: number; costUsd: number;
  confidenceScore: number; lastDecision: string; elapsedMs: number;
}
export interface WorkflowCostResult {
  cumulativeCostUsd: number; budgetLimitUsd: number;
  budgetUsedPct: number; actorCallCount: number;
}
export const workflowProgressQuery = defineQuery<WorkflowProgressResult>('workflow.progress');
export const workflowCostQuery     = defineQuery<WorkflowCostResult>('workflow.cost');

// ── Proxy activity groups with differentiated timeouts ─────────────────────────
// Standard activities: 10-minute timeout, 3 retries
const {
  runBootstrap, runScout, runFeasibilityCheck, runValueNode, runTddGate,
  runSandboxValidation, runActor, runPreflight, runAllCritics,
  runFlakinessCheck, runTestValidityReview, runIntelligentDebugger, runReplan,
  runHitlEscalation, runMemoryConsolidation,
  // Redesign: new activities
  runBaselineVerification, runImplementationPlan, runGitCheckpoint,
  runStagnationCheck,
  // ★ V2: multi-agent team, continuous verification, knowledge graph briefing
  runTestWriter, runImplementor, runContinuousVerificationCheck, runKnowledgeGraphBriefing,
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
  let state    = createInitialState(task, workflowInfo().workflowId);
  let human:   HumanDecision | null = null;
  let aborted  = false;
  let correctionScope: CancellationScope | null = null;

  // ★ V2: tracks consecutive stagnant cycles for the graduated stagnation ladder.
  // Lives here as a local orchestration variable — NOT on WorkflowState — so it
  // is never serialized into Temporal's event journal on every activity boundary.
  let consecutiveStagnationCount = 0;

  setHandler(workflowStateQuery, () => state);
  setHandler(humanResumeSignal, (d) => { human = d; });
  setHandler(humanAbortSignal, ({ reason }) => {
    log.warn('workflow.aborted', { reason });
    aborted = true;
    if (correctionScope) correctionScope.cancel();
  });
  setHandler(workflowProgressQuery, () => {
    const lastEntry = state.workflowAuditTrail[state.workflowAuditTrail.length - 1];
    return {
      phase:           state.currentPhase,
      cycle:           state.correctionCycle.attemptCount,
      costUsd:         state.cumulativeCostUsd,
      confidenceScore: state.confidenceScore,
      lastDecision:    lastEntry?.decision ?? 'session_started',
      elapsedMs:       Date.now() - state.workflowStartMs,
    };
  });
  setHandler(workflowCostQuery, () => {
    // ★ fixed: original referenced config.tokenBudget.totalUsd which doesn't exist.
    // TokenBudgetConfig exposes criticalDollar / warningDollar / costPerM* — not totalUsd.
    const budgetLimit = config.tokenBudget.criticalDollar;
    return {
      cumulativeCostUsd: state.cumulativeCostUsd,
      budgetLimitUsd:    budgetLimit,
      budgetUsedPct:     budgetLimit > 0 ? (state.cumulativeCostUsd / budgetLimit) * 100 : 0,
      actorCallCount:    state.correctionCycle.attemptCount,
    };
  });

  // ── Setup phases ──────────────────────────────────────────────────────────
  state = await runBootstrap(state);
  state = await runScout(state);

  // ★ V2: proactive organizational knowledge briefing immediately after Scout.
  // Queries the KnowledgeGraphService (via ActivityDeps.knowledgeGraph) for
  // historical failure rates, patterns, and negative decisions for this
  // repository/task-category pair, then injects the briefing into agentsMdContext.
  // No-op when no knowledgeGraph provider is wired into ActivityDeps.
  state = await runKnowledgeGraphBriefing(state);

  // ★ REDESIGN: Baseline verification — verify tests pass BEFORE touching code
  state = await runBaselineVerification(state);
  if (state.currentPhase === 'HITL_ESCALATION') {
    // ★ V2: targeted question context at every HITL site (not just a reason code)
    const ctx = buildEscalationContext(state, 'baseline_tests_failing');
    log.warn('workflow.baseline_failed_hitl', { question: ctx.targetedQuestion.question });
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
    const ctx = buildEscalationContext(state, 'high_ambiguity_before_start');
    log.warn('workflow.ambiguity_hitl', { question: ctx.targetedQuestion.question });
    state = await runHitlEscalation(state, 'high_ambiguity_before_start');
    const received = await condition(() => human !== null || aborted, config.hitl.waitTimeout);
    const hd = human as HumanDecision | null;
    if (!received || aborted || hd?.action === 'reject') { state = withPhase(state, 'FAILED'); return null; }
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
  state = await runImplementationPlan(state);

  if (!config.skipTddGate) state = await runTddGate(state);

  if (state.currentPhase === 'SANDBOX_VALIDATION') {
    state = await runSandboxValidation(state);
  }

  // ★ V2: multi-agent DAG execution — produces the first implementation pass
  // via a dependency-ordered task graph (Test Writer then Implementor, one node
  // at a time in topological order) when opted in via config.agentTeam.enabled.
  // Falls straight to the correction loop if disabled (default: false).
  // Notes on parallelism within a lane: while nodes in the same lane are
  // logically independent and could run concurrently, they each write back
  // into `state` (diffs accumulate). True parallel execution requires a
  // merge step (collect all results, merge diffs, sum costs). The sequential
  // implementation below is architecturally correct and already provides the
  // key benefits (ordered execution, role separation, TDD-first, continuous
  // verification between lanes). Parallel-within-lane is a follow-on optimization.
  let agentTeamDidFirstPass = false;
  if (config.agentTeam.enabled && state.implementationPlan) {
    agentTeamDidFirstPass = true;
    const graph = TaskGraph.fromImplementationPlan(state.implementationPlan);
    log.info('workflow.agent_team_start', {
      nodes: graph.allNodeIds().length,
      lanes: graph.parallelLanes().length,
    });

    for (const lane of graph.parallelLanes()) {
      for (const nodeId of lane) {
        const node = graph.node(nodeId);
        if (node.id.startsWith('test:')) {
          // Test Writer produces test scaffolds first (TDD)
          state = await runTestWriter(state, node);
        } else {
          // Implementor receives whatever test files were already produced
          // for the implementation files this node touches
          const testFiles: DiffEntry[] = (state.diffProposal?.diffs ?? []).filter(
            d => (state.diffProposal?.testFilePaths ?? []).includes(d.filePath),
          );
          state = await runImplementor(state, node, testFiles);
        }
      }

      // ★ V2: per-lane continuous verification — fail-fast before starting the next lane.
      // A type error or broken test in lane N is caught before lane N+1 begins,
      // instead of discovering it after the entire implementation is written.
      if (config.agentTeam.continuousVerification) {
        state = await runContinuousVerificationCheck(state);
      }
    }

    log.info('workflow.agent_team_complete', {
      files: state.diffProposal?.diffs.length ?? 0,
      cost:  state.cumulativeCostUsd.toFixed(4),
    });
  }

  // ── Correction loop (with cancellation scope for graceful abort) ──────────
  // ★ fixed: original used CancellationScope().onCancel() and .child() —
  // neither method exists in @temporalio/workflow@1.x. Correct API is
  // new CancellationScope({ cancellable: true }).run(fn) + scope.cancel().
  correctionScope = new CancellationScope({ cancellable: true });
  try {
    await correctionScope.run(async () => {
      for (let i = 0; i < config.maxSelfCorrectionCycles && !aborted; i++) {
        state = withAuditEntry(state, {
          node: 'correction_loop', decision: `cycle_start_${i}`,
          keyValues: { cycle: i, cost: state.cumulativeCostUsd },
        });

        // ★ V2: when the agent team did the first implementation pass in cycle 0,
        // its diff is already in state.diffProposal — skip the monolithic actor
        // for that cycle only. All subsequent cycles use the actor as before.
        if (!(i === 0 && agentTeamDidFirstPass)) {
          state = await runActor(state);
        }

        state = await runPreflight(state);

        // ★ REDESIGN: Split critics — fast lane always, semantic lane deferred
        state = await runAllCritics(state);

        // ★ REDESIGN: Staged verifier — 5 activities with independent retry/timeout
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

          if (config.testValidity.enabled && state.correctionCycle.attemptCount >= config.testValidity.triggerAfterCycles) {
            state = await runTestValidityReview(state);
            if (state.currentPhase === 'HITL_ESCALATION') {
              // ★ V2: test-fault targeted context lists the specific affected tests
              const ctx = buildEscalationContext(state, 'test_fault_needs_human_approval');
              log.warn('workflow.test_fault_detected', {
                tests:      state.testValidityFlag?.affectedTests,
                confidence: state.testValidityFlag?.confidence,
                question:   ctx.targetedQuestion.question,
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
        if (state.verifierVerdict?.testResult === 'PASS') {
          state = await runGitCheckpoint(state);
        }

        // Update stagnation pattern before transition logic reads it
        state = await runStagnationCheck(state);

        // ★ V2: track consecutive stagnant cycles for the graduated ladder
        consecutiveStagnationCount = trackConsecutiveStagnation(
          consecutiveStagnationCount,
          state.correctionCycle.stagnationPattern,
        );

        // Recompute confidence score after all cycle phases
        state = { ...state, confidenceScore: computeConfidenceScore(state, config) };

        const transition = computeVerifierTransition(state, config);
        log.info('workflow.transition', {
          from:                     state.currentPhase,
          to:                       transition.nextPhase,
          reason:                   transition.reason,
          confidence:               'confidence' in transition ? transition.confidence : undefined,
          attempt:                  state.correctionCycle.attemptCount,
          consecutiveStagnationCount,
        });

        state = withAuditEntry(state, {
          node:      'verifier_routing',
          decision:  `→${transition.nextPhase} (${transition.reason})`,
          keyValues: transition as unknown as Record<string, unknown>,
        });

        if (transition.nextPhase === 'MEMORY_CONSOLIDATION') break;

        // ── HITL escalation ────────────────────────────────────────────────
        if (transition.nextPhase === 'HITL_ESCALATION') {

          // ★ V2: stagnation-routed escalations go through the graduated
          // ladder before involving a human. Every other escalation reason
          // (budget, baseline, test fault, low_confidence) is a legitimate
          // one-shot trigger and routes straight to the human as before.
          if (transition.reason === 'stagnation') {
            const ladder = computeLadderDecision(consecutiveStagnationCount);
            log.info('workflow.stagnation_ladder', {
              level:  ladder.level,
              action: ladder.action,
              reason: ladder.reason,
            });
            state = withAuditEntry(state, {
              node: 'stagnation_ladder', decision: ladder.action,
              keyValues: { level: ladder.level, reason: ladder.reason },
            });

            if (ladder.action === 'enrich_prompt') {
              // Cheapest response: the next actor cycle's prompt already carries
              // the enriched scratchpad with tried-approaches history.
              continue;
            }
            if (ladder.action === 'auto_debug') {
              state = await runIntelligentDebugger(state); continue;
            }
            if (ladder.action === 'speculative_branch') {
              // Deliberately fall through to the SPECULATIVE_BRANCH block below
              // by rewriting nextPhase. The speculative branch handler is
              // identical for both the original routing and the ladder path.
              (transition as { nextPhase: string }).nextPhase = 'SPECULATIVE_BRANCH';
              // (fall-through to the SPECULATIVE_BRANCH block below)
            } else {
              // targeted_hitl or full_escalation: human, but with a specific question
              const ctx = buildEscalationContext(state, 'stagnation');
              log.warn('workflow.stagnation_hitl', {
                level:    ladder.level,
                action:   ladder.action,
                question: ctx.targetedQuestion.question,
              });
              state = await runHitlEscalation(state, 'stagnation');
              const received = await condition(() => human !== null || aborted, config.hitl.waitTimeout);
              const hd = human as HumanDecision | null;
              if (!received || aborted || hd?.action === 'reject') { state = withPhase(state, 'FAILED'); break; }
              const budgetAtEsc     = state.hitlBudgetAtEscalation ?? state.cumulativeCostUsd;
              const budgetRemaining = config.tokenBudget.criticalDollar - budgetAtEsc;
              if (budgetRemaining < config.tokenBudget.criticalDollar * 0.15) {
                log.warn('workflow.hitl_budget_too_low_for_resume', { budgetRemaining });
                state = withPhase(state, 'FAILED'); break;
              }
              if (hd?.action === 'override' && hd.guidance) {
                state = { ...state, agentsMdContext: hd.guidance, hitlPriorGuidance: hd.guidance };
              }
              human = null;
              state = withPhase(state, 'ACTOR');
              continue;
            }
          }

          // Non-stagnation HITL (budget, low_confidence, max_cycles, all_branches, …)
          if (transition.nextPhase === 'HITL_ESCALATION') { // still HITL after ladder check
            const ctx = buildEscalationContext(state, transition.reason);
            log.warn('workflow.hitl_escalation', {
              reason:   transition.reason,
              question: ctx.targetedQuestion.question,
            });
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
            if (hd?.action === 'override' && hd.guidance) {
              state = { ...state, agentsMdContext: hd.guidance, hitlPriorGuidance: hd.guidance };
            }
            human = null;
            state = withPhase(state, 'ACTOR');
            continue;
          }
        }

        if (transition.nextPhase === 'INTELLIGENT_DEBUGGER') {
          state = await runIntelligentDebugger(state); continue;
        }

        if (transition.nextPhase === 'SPECULATIVE_BRANCH') {
          // ★ V2: clean speculative forking.
          // `buildSpeculativeBranchStates` enforces a mandatory git checkpoint
          // (throws rather than forking from a dirty tree), prunes parent failure
          // history from each branch's start-state, and diversifies branches via
          // positive strategy directives instead of avoidHint-only negative instructions.
          // When git checkpointing is unavailable (config.gitCheckpoint.enabled=false),
          // falls back to the original avoidHint approach so existing setups still work.
          const activeCandidates = state.strategyCandidates
            .filter(c => !state.exhaustedBranches.includes(c.strategyId))
            .slice(0, config.maxParallelBranches);

          let branchStarts: Array<{ state: WorkflowState; candidate: (typeof activeCandidates)[number]; strategyId: string }>;
          try {
            const starts = buildSpeculativeBranchStates(state, activeCandidates);
            branchStarts = starts.map(s => ({ state: s.state, candidate: s.candidate, strategyId: s.candidate.strategyId }));
            log.info('workflow.speculative_branch_start', {
              branches: branchStarts.length,
              gitBase:  state.gitCheckpoint!.commitHash,
              mode:     'clean_fork',
            });
          } catch (forkErr) {
            // No valid git checkpoint — fall back to dirty-tree branching with avoidHints
            log.warn('workflow.speculative_branch_fallback', {
              reason: 'no git checkpoint — enable config.gitCheckpoint.enabled for clean forks',
              error:  String(forkErr),
            });
            const diversified = _diversifyStrategyCandidates(state);
            branchStarts = diversified.strategyCandidates
              .filter(c => !diversified.exhaustedBranches.includes(c.strategyId))
              .slice(0, config.maxParallelBranches)
              .map(c => ({ state: { ...diversified, selectedStrategy: c }, candidate: c, strategyId: c.strategyId }));
          }

          const branchResults = await Promise.allSettled(
            branchStarts.map((b, idx) =>
              executeChild(SpeculativeBranchWorkflow, {
                args:                    [b.state, config],
                taskQueue:               workflowInfo().taskQueue,
                workflowExecutionTimeout: '20 minutes',
                workflowId:              `${workflowInfo().workflowId}-branch-${idx}-${b.strategyId}`,
              })
            )
          );

          const winner = branchResults
            .filter((r): r is PromiseFulfilledResult<SpeculativeBranchResult> => r.status === 'fulfilled')
            .map(r => r.value)
            .find(r => r.succeeded && r.winningState);

          if (winner?.winningState) {
            state = { ...state, ...winner.winningState };
            // ★ V2: a winning branch resolved the stagnation — reset the consecutive count
            consecutiveStagnationCount = 0;
            log.info('workflow.speculative_winner', { strategies: branchStarts.length });
            break;
          }

          log.warn('workflow.speculative_all_failed', { branches: branchStarts.length });
          state = {
            ...state,
            exhaustedBranches: [...state.exhaustedBranches, ...branchStarts.map(b => b.strategyId)],
          };
          state = withPhase(state, 'HITL_ESCALATION');
          continue;
        }

        if (transition.nextPhase === 'REPLAN') { state = await runReplan(state); continue; }
        // default: ACTOR retry
      }
    });
  } catch (err) {
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
// When called from the clean-fork path, parentState is already pruned of the
// parent's failure history and carries a positive strategy directive in
// selectedStrategy.avoidHint. When called from the fallback path, parentState
// carries the original avoidHint text. Either way the interface is identical.
// ─────────────────────────────────────────────────────────────────────────────
export async function SpeculativeBranchWorkflow(
  parentState: WorkflowState,
  _config:     WorkflowConfig,
): Promise<SpeculativeBranchResult> {
  const {
    runActor, runPreflight, runAllCritics,
  } = proxyActivities<RegisteredActivities>({
    startToCloseTimeout: '10 minutes',
    retry: { maximumAttempts: 2, initialInterval: '2s', backoffCoefficient: 2 },
  });

  const { runVerifierTypeCheck } = proxyActivities<RegisteredActivities>({
    startToCloseTimeout: '2 minutes',
    retry: { maximumAttempts: 2, initialInterval: '1s', backoffCoefficient: 2 },
  });

  const { runVerifierTests } = proxyActivities<RegisteredActivities>({
    startToCloseTimeout: '10 minutes',
    retry: { maximumAttempts: 2, initialInterval: '5s', backoffCoefficient: 2 },
  });

  const { runVerifierApi } = proxyActivities<RegisteredActivities>({
    startToCloseTimeout: '5 minutes',
    retry: { maximumAttempts: 2, initialInterval: '5s', backoffCoefficient: 2 },
  });

  const { runVerifierMutation } = proxyActivities<RegisteredActivities>({
    startToCloseTimeout: '5 minutes',
    retry: { maximumAttempts: 1, initialInterval: '10s', backoffCoefficient: 2 },
  });

  const { runVerifierVisual } = proxyActivities<RegisteredActivities>({
    startToCloseTimeout: '10 minutes',
    retry: { maximumAttempts: 1, initialInterval: '10s', backoffCoefficient: 2 },
  });

  const { runGitCheckpoint, runFlakinessCheck } = proxyActivities<RegisteredActivities>({
    startToCloseTimeout: '5 minutes',
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
    if (s.verifierVerdict?.blockedByCritic !== true) {
      s = await runVerifierTypeCheck(s);
      s = await runVerifierTests(s);
      s = await runVerifierApi(s);
      s = await runVerifierMutation(s);
      s = await runVerifierVisual(s);
    }
    if (s.verifierVerdict?.testResult === 'FAIL' && s.verifierVerdict?.testFailures.length && s.verifierVerdict.testFailures.length > 0) {
      s = await runFlakinessCheck(s);
      if (s.flakinessReport && s.flakinessReport.flakyTests.length > 0) {
        log.warn('speculative.flaky_tests', { strategyId: candidate.strategyId, count: s.flakinessReport.flakyTests.length });
        return { succeeded: false, winningState: null, attempts: 1, hadFlakiness: true };
      }
    }
    if (s.verifierVerdict?.testResult === 'PASS') {
      s = await runGitCheckpoint(s);
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

/**
 * Cron-triggered shadow mode workflow.
 *
 * Runs indefinitely until the parent workflow is cancelled (e.g., on worker shutdown).
 * Each run executes ShadowModeWorkflow to autonomously discover code quality issues.
 */
export async function ShadowModeCronWorkflow(repoPath: string, maxTasks: number): Promise<void> {
  const shadowIntervalMs = 3600_000; // 1 hour between shadow runs
  let iteration = 0;

  while (true) {
    if (iteration > 0) await sleep(shadowIntervalMs);
    iteration++;
    log.info('shadow.cron_run', { iteration, repoPath, maxTasks });
    await ShadowModeWorkflow({ repoPath, maxTasks });
    log.info('shadow.cron_run_complete', { iteration });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fallback diversifier used when git checkpointing is disabled (no valid
 * checkpoint to fork from). Kept for backward compatibility; prefer
 * `buildSpeculativeBranchStates` (which requires a checkpoint) for clean forks.
 */
export function _diversifyStrategyCandidates(state: WorkflowState): WorkflowState {
  const active = state.strategyCandidates.filter(c => !state.exhaustedBranches.includes(c.strategyId));
  if (active.length < 2) return state;
  const descriptions = active.map(c => c.description);
  const updatedCandidates = state.strategyCandidates.map(c => {
    const isActive = active.some(a => a.strategyId === c.strategyId);
    if (!isActive) return c;
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
