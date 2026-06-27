import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { detectDeletedPublicMethods, containsFieldRename, isEntityFile } from './shared.js';

export async function compatibilityCritic(state: WorkflowState, deps: ActivityDeps): Promise<CriticFinding[]> {
  if (!state.diffProposal || state.task.mode !== 'BROWNFIELD') return [];
  const findings: CriticFinding[] = [];
  const taskLangId = state.task.languageIds[0] ?? 'typescript';

  for (const diff of state.diffProposal.diffs) {
    if (diff.operation !== 'modify') continue;

    // Resolve plugin: use the diff's own language field or fall back to task language
    const langId = (diff as { language?: string }).language ?? taskLangId;
    const plugin = deps.pluginRegistry.get(langId);

    // Use plugin-delegated public method detection (no more if/java hardcoding)
    const deleted = detectDeletedPublicMethods(diff.diffContent, plugin);
    for (const m of deleted) {
      findings.push({
        critic: 'compatibility', severity: 'critical',
        file: diff.filePath, line: null,
        ruleId: 'NO_DELETE_PUBLIC_API',
        message: `Public method '${m}' removed — breaking change`,
        resolutionHint: 'Deprecate instead of deleting. Add a delegation to the new implementation.',
      });
    }

    if (isEntityFile(diff.filePath) && containsFieldRename(diff.diffContent)) {
      findings.push({
        critic: 'compatibility', severity: 'critical',
        file: diff.filePath, line: null,
        ruleId: 'SCHEMA_MIGRATION_REQUIRED',
        message: 'Field renamed in entity — database migration required',
        resolutionHint: 'Add a Flyway/Liquibase migration script to rename the column.',
      });
    }
  }
  return findings;
}
