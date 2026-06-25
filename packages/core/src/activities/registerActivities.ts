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
import { verifierImpl }           from './verification/impl.js';
import { flakinessCheckImpl }     from './flakiness/impl.js';
import { testValidityReviewImpl } from './test-validity/impl.js';
import { debuggerImpl }           from './debugger/impl.js';
import { replanImpl }             from './replan/impl.js';
import { hitlImpl }               from './hitl/impl.js';
import { memoryConsolidationImpl } from './memory/impl.js';
import { runShadowCycleImpl }     from './shadow/impl.js';

export function registerActivities(deps: ActivityDeps) {
  const ctx = (s: WorkflowState): ActivityDeps => ({ ...deps, taskId: s.taskId, sessionId: s.sessionId });

  return {
    runBootstrap:           (s: WorkflowState) => bootstrapImpl(s, ctx(s)),
    runScout:               (s: WorkflowState) => scoutImpl(s, ctx(s)),
    runFeasibilityCheck:    (s: WorkflowState) => feasibilityCheckImpl(s, ctx(s)),
    runValueNode:           (s: WorkflowState) => valueNodeImpl(s, ctx(s)),
    runTddGate:             (s: WorkflowState) => tddGateImpl(s, ctx(s)),
    runSandboxValidation:   (s: WorkflowState) => sandboxValidationImpl(s, ctx(s)),
    runActor:               (s: WorkflowState) => actorImpl(s, ctx(s)),
    runPreflight:           (s: WorkflowState) => preflightImpl(s, ctx(s)),
    runAllCritics:          (s: WorkflowState) => allCriticsImpl(s, ctx(s)),
    runVerifier:            (s: WorkflowState) => verifierImpl(s, ctx(s)),
    runFlakinessCheck:      (s: WorkflowState) => flakinessCheckImpl(s, ctx(s)),
    runTestValidityReview:  (s: WorkflowState) => testValidityReviewImpl(s, ctx(s)),
    runIntelligentDebugger: (s: WorkflowState) => debuggerImpl(s, ctx(s)),
    runReplan:              (s: WorkflowState) => replanImpl(s, ctx(s)),
    runHitlEscalation:      (s: WorkflowState, reason: EscalationReason) => hitlImpl(s, reason, ctx(s)),
    runMemoryConsolidation: (s: WorkflowState) => memoryConsolidationImpl(s, ctx(s)),
    runShadowCycle:         (c: { repoPath: string; maxTasks: number }) => runShadowCycleImpl(c, deps),
  };
}

export type RegisteredActivities = ReturnType<typeof registerActivities>;
