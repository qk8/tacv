import type { ActivityDeps }   from './ActivityDeps.js';
import type { WorkflowState }  from '../state/schemas.js';
import type { EscalationReason } from '../state/transitions.js';

import { bootstrapImpl }          from './bootstrap/impl.js';
import { scoutImpl }              from './scout/impl.js';
import { feasibilityCheckImpl }   from './feasibility/impl.js';
import { valueNodeImpl }          from './value-node/impl.js';
import { tddGateImpl }            from './tdd-gate/impl.js';
import { sandboxValidationImpl }  from './sandbox-validation/impl.js';
import { actorImpl }              from './actor/impl.js';
import { preflightImpl }          from './preflight/impl.js';
import { allCriticsImpl }         from './critics/impl.js';
import { flakinessCheckImpl }     from './flakiness/impl.js';
import { testValidityReviewImpl } from './test-validity/impl.js';
import { debuggerImpl }           from './debugger/impl.js';
import { replanImpl }             from './replan/impl.js';
import { hitlImpl }               from './hitl/impl.js';
import { memoryConsolidationImpl } from './memory/impl.js';
import { runShadowCycleImpl }     from './shadow/impl.js';

// ── Redesign: new activity imports ────────────────────────────────────────────
import { baselineVerificationImpl } from './baseline/impl.js';
import { implementationPlanImpl }   from './planning/impl.js';
import { gitCheckpointImpl }        from './git-checkpoint/impl.js';
import { checkStagnationImpl }      from './stagnation/impl.js';
import {
  verifierTypeCheckStage,
  verifierTestsStage,
  verifierApiStage,
  verifierMutationStage,
  verifierVisualStage,
} from './verification/stages.js';

// ── ★ V2 redesign: agent team, continuous verification, knowledge graph ───────
import { testWriterImpl }   from '../agents/testWriter/impl.js';
import { implementorImpl }  from '../agents/implementor/impl.js';
import { mergeAgentTeamDiffs } from '../agents/mergeResults.js';
import type { TaskNode } from '../planning/graph.js';
import type { DiffEntry } from '../state/schemas.js';
import {
  runContinuousVerification as continuousVerificationCheck,
  buildInlineFeedback,
} from './verification/continuousVerifier.js';
import { applyKnowledgeGraphBriefing, inferTaskCategory } from '../workflows/scoutBriefing.js';

export function registerActivities(deps: ActivityDeps) {
  const ctx = (s: WorkflowState): ActivityDeps => ({ ...deps, taskId: s.taskId, sessionId: s.sessionId });

  return {
    // ── Original activities (kept for backward compat) ──────────────────────
    runBootstrap:           (s: WorkflowState) => bootstrapImpl(s, ctx(s)),
    runScout:               (s: WorkflowState) => scoutImpl(s, ctx(s)),
    runFeasibilityCheck:    (s: WorkflowState) => feasibilityCheckImpl(s, ctx(s)),
    runValueNode:           (s: WorkflowState) => valueNodeImpl(s, ctx(s)),
    runTddGate:             (s: WorkflowState) => tddGateImpl(s, ctx(s)),
    runSandboxValidation:   (s: WorkflowState) => sandboxValidationImpl(s, ctx(s)),
    runActor:               (s: WorkflowState) => actorImpl(s, ctx(s)),
    runPreflight:           (s: WorkflowState) => preflightImpl(s, ctx(s)),
    runAllCritics:          (s: WorkflowState) => allCriticsImpl(s, ctx(s), 'all'),
    runFastCritics:         (s: WorkflowState) => allCriticsImpl(s, ctx(s), 'fast'),
    runSemanticCritics:     (s: WorkflowState) => allCriticsImpl(s, ctx(s), 'semantic'),
    runFlakinessCheck:      (s: WorkflowState) => flakinessCheckImpl(s, ctx(s)),
    runTestValidityReview:  (s: WorkflowState) => testValidityReviewImpl(s, ctx(s)),
    runIntelligentDebugger: (s: WorkflowState) => debuggerImpl(s, ctx(s)),
    runReplan:              (s: WorkflowState) => replanImpl(s, ctx(s)),
    runHitlEscalation:      (s: WorkflowState, reason: EscalationReason) => hitlImpl(s, reason, ctx(s)),
    runMemoryConsolidation: (s: WorkflowState) => memoryConsolidationImpl(s, ctx(s)),
    runShadowCycle:         (c: { repoPath: string; maxTasks: number }) => runShadowCycleImpl(c, deps),

    // ── Redesign: new activities ─────────────────────────────────────────────
    runBaselineVerification:  (s: WorkflowState) => baselineVerificationImpl(s, ctx(s)),
    runImplementationPlan:    (s: WorkflowState) => implementationPlanImpl(s, ctx(s)),
    runGitCheckpoint:         (s: WorkflowState) => gitCheckpointImpl(s, ctx(s)),

    // Staged verifier activities (separate timeouts + retry policies in workflow)
    runVerifierTypeCheck:  (s: WorkflowState) => verifierTypeCheckStage(s, ctx(s)),
    runVerifierTests:      (s: WorkflowState) => verifierTestsStage(s, ctx(s)),
    runVerifierApi:        (s: WorkflowState) => verifierApiStage(s, ctx(s)),
    runVerifierMutation:   (s: WorkflowState) => verifierMutationStage(s, ctx(s)),
    runVerifierVisual:     (s: WorkflowState) => verifierVisualStage(s, ctx(s)),

    // Stagnation detection — pure computation, no I/O
    runStagnationCheck: (s: WorkflowState) => {
      const { pattern, newCycle } = checkStagnationImpl(s, deps.config.stagnation.semanticSimilarityThreshold);
      return Promise.resolve({ ...s, correctionCycle: newCycle });
    },

    // ── ★ V2 redesign: multi-agent team (one node at a time; the workflow
    // iterates DAG lanes and calls these per node, in parallel within a lane) ──
    runTestWriter: async (s: WorkflowState, node: TaskNode): Promise<WorkflowState> => {
      const result = await testWriterImpl(node, s, ctx(s));
      const merged = mergeAgentTeamDiffs([
        { diffs: s.diffProposal?.diffs ?? [], summary: s.diffProposal?.summary ?? '', costUsd: 0, roleViolations: [] },
        result,
      ]);
      return { ...s, diffProposal: merged.diffProposal, cumulativeCostUsd: s.cumulativeCostUsd + result.costUsd };
    },

    runImplementor: async (s: WorkflowState, node: TaskNode, testFiles: DiffEntry[]): Promise<WorkflowState> => {
      const result = await implementorImpl(node, s, testFiles, ctx(s));
      const merged = mergeAgentTeamDiffs([
        { diffs: s.diffProposal?.diffs ?? [], summary: s.diffProposal?.summary ?? '', costUsd: 0, roleViolations: [] },
        result,
      ]);
      return { ...s, diffProposal: merged.diffProposal, cumulativeCostUsd: s.cumulativeCostUsd + result.costUsd };
    },

    // ★ V2: per-file fail-fast verification during the multi-agent DAG
    // execution phase, distinct from (and complementary to) the existing
    // end-of-cycle staged verifier used by the correction loop.
    runContinuousVerificationCheck: async (s: WorkflowState): Promise<WorkflowState> => {
      if (!s.diffProposal || s.diffProposal.diffs.length === 0) return s;
      const knownTestFiles = s.diffProposal.testFilePaths;
      const outcome = await continuousVerificationCheck(s.diffProposal.diffs, knownTestFiles, ctx(s));
      if (outcome.allOk) return s;
      const lastResult = outcome.results[outcome.results.length - 1];
      const feedback = lastResult ? buildInlineFeedback(lastResult) : 'Continuous verification found an issue.';
      const note = `[continuous-verify] ${feedback}`;
      return { ...s, sessionScratchpad: s.sessionScratchpad ? `${s.sessionScratchpad}\n${note}` : note };
    },

    // ★ V2: proactive organizational-knowledge briefing, applied once right
    // after Scout. A no-op when no knowledgeGraph provider is configured.
    runKnowledgeGraphBriefing: async (s: WorkflowState): Promise<WorkflowState> => {
      if (!deps.knowledgeGraph) return s;
      const category = inferTaskCategory(s.task.description);
      const briefing = deps.knowledgeGraph.buildScoutBriefing(s.task.moduleType, category);
      return applyKnowledgeGraphBriefing(s, briefing);
    },
  };
}

export type RegisteredActivities = ReturnType<typeof registerActivities>;
