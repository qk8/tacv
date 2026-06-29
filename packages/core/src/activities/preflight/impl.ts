import { execFile as realExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkflowState } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const realExecFileAsync = promisify(realExecFile);
const log = createLogger('tacv.preflight');

type GitExecutor = (args: string[], cwd: string) => Promise<string>;

function makeGitExecutor(execFileFn: typeof realExecFile): GitExecutor {
  const fn = promisify(execFileFn);
  return async (args: string[], cwd: string) => {
    const { stdout } = await fn('git', args, { cwd });
    return stdout.trim();
  };
}

export async function preflightImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  if (!state.diffProposal) return { ...state, currentPhase: 'CRITICS' };

  log.info('preflight.start', { files: state.diffProposal.diffs.length });

  const changedFiles = state.diffProposal.diffs.map(d => d.filePath);
  const findings: import('../../state/schemas.js').CriticFinding[] = [];

  for (const languageId of state.task.languageIds) {
    const plugin = deps.pluginRegistry.get(languageId);
    const langFiles = changedFiles.filter(f => plugin.metadata.extensions.some(e => f.endsWith(e)));
    if (langFiles.length === 0) continue;

    // Lint only — type-check is done in verifierTypeCheckStage with its own timeout/retry
    const lintResult = await plugin.lint(deps.repoPath, langFiles);
    findings.push(...lintResult.violations.map(v => ({
      critic: 'style' as const, severity: 'warning' as const,
      file: v.file, line: v.line, ruleId: v.ruleId,
      message: v.message, resolutionHint: v.resolutionHint,
    })));
  }

  // F3: Diff reconciliation — augment diffProposal with unreported filesystem changes
  if (deps.config.gitCheckpoint.enabled) {
    try {
      const git = deps.gitExecutor ?? makeGitExecutor(deps.execFile ?? realExecFile);
      const actualFiles = (await git(['diff', '--name-only', 'HEAD'], deps.repoPath))
        .split('\n').filter(f => f.length > 0);
      const reportedSet = new Set(changedFiles);
      const unreported = actualFiles.filter(f => !reportedSet.has(f));

      if (unreported.length > 0) {
        log.warn('preflight.diff_reconciliation', {
          reported: changedFiles.length, actual: actualFiles.length, unreported,
        });

        const augmentedDiffs = [...state.diffProposal.diffs];
        for (const filePath of unreported) {
          try {
            const diffContent = await git(
              ['diff', 'HEAD', '--', filePath], deps.repoPath,
            );
            // Infer language from file extension
            const language = filePath.endsWith('.ts') || filePath.endsWith('.tsx')
              ? 'typescript' : filePath.endsWith('.js') || filePath.endsWith('.jsx')
                ? 'javascript' : filePath.endsWith('.py') ? 'python' : undefined;
            augmentedDiffs.push({ filePath, operation: 'modify' as const, diffContent, language });
          } catch (err) {
            log.warn('preflight.diff_reconciliation.file_failed', { file: filePath, error: String(err) });
          }
        }

        state = { ...state, diffProposal: { ...state.diffProposal, diffs: augmentedDiffs } };
      }
    } catch (err) {
      log.warn('preflight.diff_reconciliation.failed', { error: String(err) });
    }
  }

  log.info('preflight.complete', { findings: findings.length });
  return { ...state, currentPhase: 'CRITICS', criticFindings: findings };
}
