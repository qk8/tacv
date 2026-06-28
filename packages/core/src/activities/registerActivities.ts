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
  };
}

export type RegisteredActivities = ReturnType<typeof registerActivities>;
