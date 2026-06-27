import type { WorkflowState } from '../../state/schemas.js';
import { FeasibilityAssessment } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.feasibility');

export async function feasibilityCheckImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  if (!deps.config.feasibility.enabled) return { ...state, currentPhase: 'VALUE_NODE' };

  log.info('feasibility.start', { taskId: state.taskId });

  let assessment: FeasibilityAssessment;
  try {
    assessment = await deps.extractor.extract(
      `Task: ${state.task.description}
Mode: ${state.task.mode}
Module: ${state.task.moduleType}
Languages: ${state.task.languageIds.join(', ')}
${state.agentsMdContext ? `Project conventions:\n${state.agentsMdContext.slice(0, 800)}` : ''}

Rate this task on each dimension (0–5 scale):
- ambiguity: 0=crystal clear, 5=many unstated assumptions or contradictions
- complexity: 0=trivial change, 5=requires major architectural restructuring  
- risk: 0=isolated change, 5=high blast radius or irreversible brownfield impact

List any specific ambiguities that MUST be clarified before coding begins.
Set shouldEscalateEarly=true if ambiguity>=4 OR (complexity>=4 AND risk>=4).`,
      FeasibilityAssessment,
      { system: 'You assess software development task feasibility. Be pragmatic — only flag genuine blockers.', model: deps.config.feasibility.model },
    );
  } catch (err) {
    log.warn('feasibility.extract_failed', { error: String(err) });
    return { ...state, currentPhase: 'VALUE_NODE', feasibility: null };
  }

  log.info('feasibility.assessed', {
    ambiguity: assessment.ambiguity, complexity: assessment.complexity,
    risk: assessment.risk, shouldEscalate: assessment.shouldEscalateEarly,
  });

  if (assessment.shouldEscalateEarly) {
    log.warn('feasibility.early_escalation', { reason: assessment.escalationReason, ambiguities: assessment.ambiguities });
    return {
      ...state,
      feasibility: assessment,
      currentPhase: 'HITL_ESCALATION',
      escalationPayload: {
        reason: 'high_ambiguity_before_start',
        ambiguities: assessment.ambiguities,
        scores: { ambiguity: assessment.ambiguity, complexity: assessment.complexity, risk: assessment.risk },
        hint: 'Clarify the ambiguities above and resume with --action override --guidance "..."',
        estimatedCostIfProceeded: `$${(deps.config.tokenBudget.criticalDollar * 0.6).toFixed(0)}–$${deps.config.tokenBudget.criticalDollar.toFixed(0)}`,
      },
      workflowAuditTrail: [...state.workflowAuditTrail, {
        timestampMs: Date.now(), node: 'feasibility_check',
        decision: 'early_hitl_escalation',
        keyValues: { ambiguity: assessment.ambiguity, ambiguities: assessment.ambiguities },
      }],
    };
  }

  return { ...state, feasibility: assessment, currentPhase: 'VALUE_NODE' };
}
