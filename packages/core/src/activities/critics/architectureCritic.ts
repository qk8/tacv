import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';

export async function architectureCritic(state: WorkflowState, deps: ActivityDeps): Promise<CriticFinding[]> {
  if (!state.diffProposal || state.task.mode !== 'GREENFIELD') return [];
  const findings: CriticFinding[] = [];
  for (const diff of state.diffProposal.diffs) {
    const plugin = deps.pluginRegistry.getForFile(diff.filePath);
    if (!plugin) continue;
    const result = await plugin.checkArchRules(deps.repoPath);
    findings.push(...result.violations.map(v => ({ critic: 'architecture' as const, severity: 'critical' as const, file: v.file, line: v.line, ruleId: v.ruleId, message: v.message, resolutionHint: v.resolutionHint })));
  }
  return findings;
}
