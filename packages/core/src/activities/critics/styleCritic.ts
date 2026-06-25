import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';

export async function styleCritic(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<CriticFinding[]> {
  if (!state.diffProposal) return [];
  const findings: CriticFinding[] = [];

  for (const diff of state.diffProposal.diffs) {
    if (diff.operation === 'delete') continue;
    const plugin = deps.pluginRegistry.getForFile(diff.filePath);
    if (!plugin) continue;

    const result = await plugin.lint(deps.repoPath, [diff.filePath])
      .catch(() => ({ violations: [], durationMs: 0 }));

    for (const v of result.violations) {
      findings.push({
        critic:         'style',
        severity:       'warning',
        file:           v.file,
        line:           v.line ?? null,
        ruleId:         v.ruleId,
        message:        v.message,
        resolutionHint: v.resolutionHint,
      });
    }
  }

  return findings;
}
