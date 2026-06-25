import { z } from 'zod';
import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.critics.requirement_trace');

const RequirementTrace = z.array(z.object({
  requirement: z.string(),
  implemented: z.boolean(),
  discrepancy: z.string().nullable(),
}));

export async function requirementTraceCritic(state: WorkflowState, deps: ActivityDeps): Promise<CriticFinding[]> {
  if (!state.diffProposal) return [];
  const diffSummary = state.diffProposal.diffs
    .filter(d => !d.filePath.includes('.test.') && !d.filePath.includes('Test.'))
    .map(d => `${d.filePath}:\n${d.diffContent.slice(0, 600)}`)
    .join('\n---\n');
  if (!diffSummary.trim()) return [];
  try {
    const traces = await deps.extractor.extract(
      `Original task requirement: ${state.task.description}
       
       Implementation summary: ${state.diffProposal.summary}
       
       Diff (production code):
       ${diffSummary.slice(0, 2000)}
       
       For each distinct requirement stated in the task, determine whether it is correctly implemented.
       Focus on semantic correctness, not code style.
       Only flag genuine requirement mismatches, not missing features that weren't specified.`,
      RequirementTrace,
      { system: 'You verify that an implementation fulfils its stated requirements precisely. Be conservative — only report clear mismatches.', model: 'claude-haiku-4-5-20251001' },
    );
    return traces
      .filter(t => !t.implemented || t.discrepancy)
      .map(t => ({
        critic: 'requirement_trace' as const, severity: 'critical' as const,
        file: state.diffProposal!.diffs[0]?.filePath ?? 'unknown', line: null,
        ruleId: 'REQUIREMENT_NOT_MET',
        message: `Requirement "${t.requirement.slice(0, 100)}" not correctly implemented${t.discrepancy ? ': ' + t.discrepancy : ''}`,
        resolutionHint: `Re-read the task description. Ensure "${t.requirement}" is addressed exactly as specified.`,
      }));
  } catch (err) {
    log.warn('requirement_trace_critic.failed', { error: String(err) });
    return [];
  }
}
