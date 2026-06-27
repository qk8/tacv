import type { WorkflowState, GitCheckpoint } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const log = createLogger('tacv.git_checkpoint');

/**
 * Git Checkpoint — runs AFTER a successful verifier pass.
 *
 * Creates a git commit on a dedicated branch after each verifier PASS,
 * enabling:
 *   1. True rollback — speculative branches can fork from this commit
 *   2. PR creation at the end of the session
 *   3. Audit history showing exactly what changed at each correction cycle
 *
 * Improvement over TACV original: TACV applied diffs but never committed,
 * so speculative branches started from a dirty working tree. This makes
 * speculative branching semantically correct.
 *
 * Failures are non-fatal — if git is unavailable, we log a warning and
 * continue with a null commitHash.
 */
export async function gitCheckpointImpl(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<WorkflowState> {
  const cfg = deps.config.gitCheckpoint;
  if (!cfg.enabled) {
    return state;
  }

  const changedFiles = state.diffProposal?.diffs.map(d => d.filePath) ?? [];
  const branch       = `${cfg.branchPrefix}${state.taskId}`;
  const cycleNumber  = state.correctionCycle.attemptCount;

  log.info('git_checkpoint.start', { branch, files: changedFiles.length, cycle: cycleNumber });

  let commitHash: string | null = null;

  try {
    await runGit(`git checkout -B ${branch}`, deps.repoPath);
    if (changedFiles.length > 0) {
      await runGit(`git add ${changedFiles.map(f => `"${f}"`).join(' ')}`, deps.repoPath);
      const msg = `tacv(cycle-${cycleNumber}): ${state.task.description.slice(0, 60)}`;
      await runGit(
        `git -c user.name="${cfg.authorName}" -c user.email="${cfg.authorEmail}" commit -m "${msg}" --allow-empty`,
        deps.repoPath,
      );
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: deps.repoPath });
      commitHash = stdout.trim();
    }
    log.info('git_checkpoint.committed', { hash: commitHash, branch });
  } catch (err) {
    log.warn('git_checkpoint.failed', { error: String(err), hint: 'Continuing without git checkpoint' });
  }

  const checkpoint: GitCheckpoint = {
    commitHash,
    branch,
    checkpointAt: Date.now(),
    changedFiles,
    cycleNumber,
  };

  return {
    ...state,
    gitCheckpoint: checkpoint,
    workflowAuditTrail: [...state.workflowAuditTrail, {
      timestampMs: Date.now(), node: 'git_checkpoint',
      decision:   commitHash ? 'committed' : 'skipped_git_error',
      keyValues:  { commitHash, branch, files: changedFiles.length },
    }],
  };
}

async function runGit(cmd: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(cmd, { cwd });
  return stdout.trim();
}
