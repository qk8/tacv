import { z } from 'zod';
import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { isTestFile } from './testPreservationCritic.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.critics.scope_creep');

const ScopeCheck = z.object({
  inScope:    z.array(z.string()),
  outOfScope: z.array(z.object({ file: z.string(), reason: z.string() })),
});

export async function scopeCreepCritic(state: WorkflowState, deps: ActivityDeps): Promise<CriticFinding[]> {
  if (!state.diffProposal || state.task.mode !== 'BROWNFIELD') return [];
  const changedNonTestFiles = state.diffProposal.diffs
    .filter(d => !isTestFile(d.filePath) && d.operation !== 'delete')
    .map(d => `${d.filePath} (${d.operation})`);
  if (changedNonTestFiles.length <= 1) return [];
  try {
    const check = await deps.extractor.extract(
      `Task: ${state.task.description}
       
       Files changed by the agent: 
       ${changedNonTestFiles.join('\n')}
       
       In BROWNFIELD mode, changes should be minimal and targeted.
       Identify any files that appear out of scope for this specific task.
       A file is out-of-scope if modifying it is not directly required by the task description.`,
      ScopeCheck,
      { system: 'You enforce minimal change scope in brownfield codebases. Flag any file changes that are unnecessary for the given task.', model: 'claude-haiku-4-5-20251001' },
    );
    return check.outOfScope.map(oos => ({
      critic: 'scope_creep' as const, severity: 'warning' as const,
      file: oos.file, line: null,
      ruleId: 'OUT_OF_SCOPE_CHANGE',
      message: `File '${oos.file}' modified but appears outside task scope: ${oos.reason}`,
      resolutionHint: 'Revert changes to this file. Only modify files directly required by the task description.',
    }));
  } catch (err) {
    log.warn('scope_creep_critic.failed', { error: String(err) });
    return [];
  }
}
