import { z } from 'zod';
import type { WorkflowState, ImplementationPlan, CriticFinding } from '../../state/schemas.js';
import { withAuditEntry } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

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

  // Structural plan-quality checks — replaces dead code that checked state.diffProposal
  // (which is always null at planning time since the actor hasn't run yet)
  let fastCriticFindings: CriticFinding[] = [];

  if (deps.config.planning.validateWithFastCritics) {
    const totalFiles = rawPlan.filesToCreate.length + rawPlan.filesToModify.length + rawPlan.filesToDelete.length;

    // Check for scope creep in BROWNFIELD — too many files is suspicious
    if (state.task.mode === 'BROWNFIELD' && totalFiles > 10) {
      fastCriticFindings.push({
        critic: 'scope_creep', severity: 'critical' as const, file: '(plan)',
        line: null, ruleId: 'PLAN_TOO_BROAD',
        message: `Plan touches ${totalFiles} files in BROWNFIELD mode; this is unusually broad.`,
        resolutionHint: 'Narrow scope — only modify files the task strictly requires.',
      });
    }

    // Flag high complexity + high risk as needing extra scrutiny
    if (rawPlan.estimatedComplexity === 'high' && rawPlan.riskyAreas.length > 3) {
      fastCriticFindings.push({
        critic: 'architecture', severity: 'critical' as const, file: '(plan)',
        line: null, ruleId: 'PLAN_HIGH_RISK',
        message: `High complexity + ${rawPlan.riskyAreas.length} risky areas.`,
        resolutionHint: 'Consider decomposing into smaller subtasks or add extra defensive tests.',
      });
    }

    // Flag if no test files are planned (TDD violation)
    if (rawPlan.testFilesToCreate.length === 0 && rawPlan.filesToCreate.length > 0) {
      fastCriticFindings.push({
        critic: 'test_preservation', severity: 'critical' as const, file: '(plan)',
        line: null, ruleId: 'PLAN_NO_TEST_FILES',
        message: 'Plan creates source files but lists no test files.',
        resolutionHint: 'Add at least one test file per new source file (TDD).',
      });
    }
  }

  const criticsApproved = fastCriticFindings.filter(f => f.severity === 'critical').length === 0;

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
