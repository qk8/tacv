import { z } from 'zod';
import type { WorkflowState } from '../../state/schemas.js';
import { withAuditEntry } from '../../state/schemas.js';
import { FeasibilityAssessment } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.feasibility');

const SubtaskSchema = z.object({
  subtasks: z.array(z.object({
    description:           z.string(),
    estimatedComplexity:   z.enum(['low', 'medium']),
  })).min(2).max(4),
});

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
    return withAuditEntry({
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
    }, { node: 'feasibility_check', decision: 'early_hitl_escalation', keyValues: { ambiguity: assessment.ambiguity, ambiguities: assessment.ambiguities } });
  }

  // F2: Decompose high-complexity, low-ambiguity tasks into subtasks
  if (assessment.complexity >= 4 && assessment.ambiguity < 3 && !assessment.shouldEscalateEarly) {
    try {
      const decomposed = await deps.extractor.extract(
        `This task is highly complex. Decompose it into 2-4 independent subtasks that can each be implemented in isolation.\nTask: ${state.task.description}\nMode: ${state.task.mode}`,
        SubtaskSchema,
        { system: 'You decompose complex software tasks. Each subtask should be a self-contained, testable unit of work.', model: deps.config.feasibility.model },
      ).catch(() => null);

      if (decomposed?.subtasks && decomposed.subtasks.length >= 2) {
        log.info('feasibility.decomposed', { subtasks: decomposed.subtasks.length });
        const assessmentWithDecomp = { ...assessment, escalationReason: 'decomposed_into_subtasks' };
        return withAuditEntry({
          ...state,
          feasibility: assessmentWithDecomp,
          currentPhase: 'VALUE_NODE',
          sessionScratchpad: `Decomposed into ${decomposed.subtasks.length} subtasks:\n${
            decomposed.subtasks.map((s, i) => `${i + 1}. ${s.description} (complexity: ${s.estimatedComplexity})`).join('\n')
          }`,
        }, { node: 'feasibility_check', decision: 'task_decomposed', keyValues: { subtasks: decomposed.subtasks.length } });
      }
    } catch (err) {
      log.warn('feasibility.decomposition_failed', { error: String(err) });
    }
  }

  return { ...state, feasibility: assessment, currentPhase: 'VALUE_NODE' };
}
