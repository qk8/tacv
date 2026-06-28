import { stat } from 'node:fs/promises';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.repo_path');

/**
 * Validates that repoPath exists and is a directory.
 * Skips validation for '.' or empty string (current directory).
 * Throws a clear error for non-existent or invalid paths.
 */
export async function validateRepoPath(repoPath: string): Promise<void> {
  if (!repoPath || repoPath === '.') return;

  try {
    const s = await stat(repoPath);
    if (!s.isDirectory()) {
      throw new Error(`repoPath '${repoPath}' exists but is not a directory`);
    }
    log.info('repo_path_validated', { repoPath });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      log.error('repo_path_not_found', { repoPath });
      throw new Error(`repoPath not found: ${repoPath}`);
    }
    if (err instanceof Error && err.message.includes('is not a directory')) {
      throw err;
    }
    throw err;
  }
}
