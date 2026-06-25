import { z } from 'zod';
import type { WorkflowState, DiffProposal } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { computeConfidenceScore } from '../../state/transitions.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.actor');
const ACTOR_PROMPT_VERSION = '2026-06-15-v2';

const DiffOutput = z.object({
  diffs: z.array(z.object({
    filePath: z.string(), operation: z.enum(['create','modify','delete']),
    diffContent: z.string(), language: z.string(),
  })),
  summary: z.string(),
  testFilePaths: z.array(z.string()),
});

export async function actorImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  const attempt = state.correctionCycle.attemptCount;
  log.info('actor.start', { attempt, taskId: state.taskId, promptVersion: ACTOR_PROMPT_VERSION });

  const systemPrompt = buildActorSystem(state, deps);
  const userPrompt   = buildCompressedActorPrompt(state, deps.config.maxSelfCorrectionCycles);

  const result = await deps.agent.runTask(userPrompt, { repoPath: deps.repoPath }, {
    role: 'actor', systemPrompt, maxTurns: 20,
    allowedTools: ['read_file','write_file','list_directory','run_bash','search_files'],
    promptVersion: ACTOR_PROMPT_VERSION,
  }, state.cumulativeCostUsd);

  let diffProposal: DiffProposal | null = state.diffProposal;
  try {
    const jsonMatch = result.content.match(/```json\n([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      const parsed = DiffOutput.safeParse(JSON.parse(jsonMatch[1]));
      if (parsed.success) diffProposal = parsed.data;
    }
  } catch { /* use existing diff */ }

  const newCost  = state.cumulativeCostUsd + result.callCostUsd;
  const newCycle = { ...state.correctionCycle, attemptCount: attempt + 1, branchName: state.correctionCycle.branchName ?? 'main' };
  const newConf  = computeConfidenceScore({ ...state, correctionCycle: newCycle, cumulativeCostUsd: newCost }, deps.config);

  log.info('actor.complete', {
    attempt: attempt + 1, costDelta: result.callCostUsd.toFixed(4),
    diffFiles: diffProposal?.diffs.length ?? 0, promptVersion: ACTOR_PROMPT_VERSION,
  });

  return {
    ...state,
    currentPhase:      'PREFLIGHT',
    diffProposal,
    correctionCycle:   newCycle,
    cumulativeCostUsd: newCost,
    confidenceScore:   newConf,
    workflowAuditTrail: [...state.workflowAuditTrail, {
      timestampMs: Date.now(), node: 'actor',
      decision: 'diff_generated',
      keyValues: { attempt: attempt + 1, files: diffProposal?.diffs.length ?? 0, costUsd: newCost.toFixed(4) },
    }],
  };
}

function buildActorSystem(state: WorkflowState, deps: ActivityDeps): string {
  const modeHints = state.task.mode === 'GREENFIELD'
    ? `Apply Clean Architecture, DDD bounded contexts, and SOLID principles. Write tests FIRST (TDD).`
    : `Match existing code patterns. Make MINIMAL changes — only what the task strictly requires. Preserve all existing tests and public APIs.`;

  const libraryDocsHint = state.task.mode === 'GREENFIELD'
    ? '\nUse only the library versions present in the existing package.json / pom.xml.'
    : '';

  return `You are an expert ${state.task.languageIds.join('/')} developer.
Mode: ${state.task.mode} — ${modeHints}${libraryDocsHint}

${state.agentsMdContext ? `## Project Conventions:\n${state.agentsMdContext.slice(0, 2000)}` : ''}

After making changes, output a JSON code block with your diff:
\`\`\`json
{"diffs":[{"filePath":"...","operation":"create|modify|delete","diffContent":"...","language":"..."}],"summary":"...","testFilePaths":["..."]}
\`\`\``.trim();
}

/** Compressed prompt — only current-cycle context, not accumulating history */
function buildCompressedActorPrompt(state: WorkflowState, maxCycles: number): string {
  const attempt = state.correctionCycle.attemptCount;
  const remaining = maxCycles - attempt;
  const budgetLeft = (state.cumulativeCostUsd > 0)
    ? ` Budget used: $${state.cumulativeCostUsd.toFixed(2)}.`
    : '';

  const parts: string[] = [
    `## Task\n${state.task.description}`,
    `## Attempt ${attempt + 1} of ${maxCycles} (${remaining} remaining)${budgetLeft}`,
  ];

  // Current-cycle failures only — NOT all historical failures
  const currentFailures = state.verifierVerdict?.testFailures?.slice(0, 8) ?? [];
  if (currentFailures.length > 0) {
    parts.push(`## Failing Tests (fix these)\n${currentFailures.map(f => `- [${f.testName ?? 'test'}] ${f.message.slice(0, 200)}`).join('\n')}`);
  }

  // Debug root cause (single paragraph, already compressed)
  if (state.debugObservations?.rootCause) {
    parts.push(`## Debug Analysis\n${state.debugObservations.rootCause.slice(0, 400)}`);
  }

  // Only critical critic findings — not warnings — to reduce noise
  const critical = state.criticFindings.filter(f => f.severity === 'critical').slice(0, 6);
  if (critical.length > 0) {
    parts.push(`## Must Fix (Critics)\n${critical.map(f => `- [${f.ruleId}] ${f.file}: ${f.message}\n  Fix: ${f.resolutionHint}`).join('\n')}`);
  }

  // Scope warning for brownfield
  if (state.scopeViolations.length > 0) {
    parts.push(`## ⚠️ Scope Warning\nPrevious attempt touched files outside task scope. Only modify files directly required.\nOOT files: ${state.scopeViolations.map(v => v.file).join(', ')}`);
  }

  // Test files to make pass
  if (state.diffProposal?.testFilePaths.length) {
    parts.push(`## Test Files to Pass\n${state.diffProposal.testFilePaths.join('\n')}`);
  }

  // Diversity hint for speculative branches
  if (state.selectedStrategy?.avoidHint) {
    parts.push(`## Approach Constraint\n${state.selectedStrategy.avoidHint}`);
  }

  // Stagnation hint — suggest a completely different approach
  if (state.correctionCycle.stagnationPattern !== 'none') {
    parts.push(`## ⚠️ Stagnation Detected (${state.correctionCycle.stagnationPattern})\nPrevious attempts produced the same error repeatedly. Take a completely different approach.`);
  }

  return parts.join('\n\n');
}
