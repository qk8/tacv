import type { WorkflowState } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.preflight');

export async function preflightImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  if (!state.diffProposal) return { ...state, currentPhase: 'CRITICS' };

  log.info('preflight.start', { files: state.diffProposal.diffs.length });

  const changedFiles = state.diffProposal.diffs.map(d => d.filePath);
  const findings: import('../../state/schemas.js').CriticFinding[] = [];

  for (const languageId of state.task.languageIds) {
    const plugin = deps.pluginRegistry.get(languageId);
    const langFiles = changedFiles.filter(f => plugin.metadata.extensions.some(e => f.endsWith(e)));
    if (langFiles.length === 0) continue;

    // Type check
    const typeResult = await plugin.typeCheck(deps.repoPath, langFiles);
    findings.push(...typeResult.violations.map(v => ({
      critic: 'style' as const, severity: 'critical' as const,
      file: v.file, line: v.line, ruleId: v.ruleId,
      message: v.message, resolutionHint: v.resolutionHint,
    })));

    // Lint
    const lintResult = await plugin.lint(deps.repoPath, langFiles);
    findings.push(...lintResult.violations.map(v => ({
      critic: 'style' as const, severity: 'warning' as const,
      file: v.file, line: v.line, ruleId: v.ruleId,
      message: v.message, resolutionHint: v.resolutionHint,
    })));
  }

  log.info('preflight.complete', { findings: findings.length });
  return { ...state, currentPhase: 'CRITICS', criticFindings: findings };
}
