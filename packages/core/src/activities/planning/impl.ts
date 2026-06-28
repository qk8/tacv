import { z } from 'zod';
import type { WorkflowState, ImplementationPlan, CriticFinding } from '../../state/schemas.js';
import { withAuditEntry } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';
import { styleCritic }       from '../critics/styleCritic.js';
import { securityCritic }    from '../critics/securityCritic.js';
import { consistencyCritic } from '../critics/consistencyCritic.js';

const log = createLogger('tacv.planning');

const PlanSchema = z.object({
  planSummary:         z.string().min(1),
  filesToCreate:       z.array(z.string()),
  filesToModify:       z.array(z.string()),
  filesToDelete:       z.array(z.string()),
  testFilesToCreate:   z.array(z.string()),
  estimatedComplexity: z.enum(['low', 'medium', 'high']),
  riskyAreas:          z.array(z.string()),
});

/**
 * Implementation Planning — runs AFTER Value Node, BEFORE TDD Gate.
 *
 * The agent produces a detailed file-by-file implementation plan BEFORE writing
 * any code. Fast-lane critics validate the plan structure (scope, file count, risk).
 *
 * Improvement over TACV original: TACV had the agent jump straight to coding
 * after strategy selection. This step validates architectural intent up front,
 * catching scope creep and dangerous patterns before any cycles are wasted.
 */
export async function implementationPlanImpl(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<WorkflowState> {
  if (!deps.config.planning.enabled) {
    log.info('planning.skipped_disabled');
    return { ...state, currentPhase: 'TDD_GATE', implementationPlan: null };
  }

  log.info('planning.start', { task: state.task.description.slice(0, 80) });

  const planPrompt = buildPlanPrompt(state);
  let rawPlan: z.infer<typeof PlanSchema>;

  try {
    rawPlan = await deps.extractor.extract(planPrompt, PlanSchema, {
      system: [
        'You are a senior software engineer creating a precise implementation plan.',
        'Be specific about which files to create, modify, or delete.',
        'Keep scope minimal in BROWNFIELD mode — only change what the task strictly requires.',
        'Identify risky areas proactively so the actor can plan defensive test coverage.',
      ].join(' '),
      model: deps.config.planning.model,
    });
  } catch (err) {
    log.warn('planning.extractor_failed', { error: String(err) });
    return withAuditEntry({
      ...state,
      currentPhase:       'TDD_GATE',
      implementationPlan: null,
    }, { node: 'implementation_plan', decision: 'plan_skipped_extractor_error', keyValues: { error: String(err) } });
  }

  // Run fast critics on the plan if a diffProposal exists
  // (The plan is validated structurally; semantic critics run later in the correction loop)
  let fastCriticFindings: CriticFinding[] = [];
  if (deps.config.planning.validateWithFastCritics && state.diffProposal) {
    const fastResults = await Promise.allSettled([
      styleCritic(state, deps),
      securityCritic(state, deps),
      consistencyCritic(state, deps),
    ]);
    for (const r of fastResults) {
      if (r.status === 'fulfilled') fastCriticFindings.push(...r.value);
    }
  }

  const criticsApproved = fastCriticFindings.length === 0;  // any finding = plan needs attention

  const plan: ImplementationPlan = {
    ...rawPlan,
    criticsApproved,
    fastCriticFindings,
  };

  log.info('planning.complete', {
    files: rawPlan.filesToCreate.length + rawPlan.filesToModify.length,
    complexity: rawPlan.estimatedComplexity,
    criticsApproved,
    criticsWarnings: fastCriticFindings.length,
  });

  return withAuditEntry({
    ...state,
    currentPhase:       'TDD_GATE',
    implementationPlan: plan,
  }, { node: 'implementation_plan', decision: 'plan_created', keyValues: { files: rawPlan.filesToCreate.length + rawPlan.filesToModify.length, complexity: rawPlan.estimatedComplexity, riskyAreas: rawPlan.riskyAreas.length, approved: criticsApproved } });
}

function buildPlanPrompt(state: WorkflowState): string {
  const agentsMd = state.agentsMdContext
    ? `\n## Project conventions (AGENTS.md):\n${state.agentsMdContext.slice(0, 2000)}`
    : '';
  const strategy = state.selectedStrategy
    ? `\n## Selected strategy:\n${state.selectedStrategy.description}\nRisk: ${state.selectedStrategy.estimatedRisk}`
    : '';
  const scratchpad = state.sessionScratchpad
    ? `\n## Prior notes (session scratchpad):\n${state.sessionScratchpad.slice(0, 1000)}`
    : '';

  return `
Task: ${state.task.description}
Mode: ${state.task.mode}
Language(s): ${state.task.languageIds.join(', ')}
Module type: ${state.task.moduleType}
${agentsMd}
${strategy}
${scratchpad}

Create a detailed implementation plan with:
- planSummary: one paragraph describing the approach
- filesToCreate: new files to create
- filesToModify: existing files that need changes
- filesToDelete: files to remove (be conservative)
- testFilesToCreate: new test files
- estimatedComplexity: low | medium | high
- riskyAreas: parts of the change most likely to cause regressions

In BROWNFIELD mode, minimize the number of files changed. Do not modify files
outside the task's blast radius.
`.trim();
}
