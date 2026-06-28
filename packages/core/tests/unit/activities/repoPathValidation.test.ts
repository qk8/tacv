import { describe, it, expect } from 'vitest';
import { validateRepoPath } from '../../../src/activities/infrastructure/repoPathValidation.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('validateRepoPath', () => {
  it('throws when path does not exist', async () => {
    await expect(validateRepoPath('/nonexistent/path/abc123')).rejects.toThrow('repoPath not found');
  });

  it('throws when path is a file, not a directory', async () => {
    const tmpFile = join(tmpdir(), 'tacv_test_repo_file');
    try {
      writeFileSync(tmpFile, 'test content');
      await expect(validateRepoPath(tmpFile)).rejects.toThrow('is not a directory');
    } finally {
      rmSync(tmpFile, { force: true });
    }
  });

  it('returns void when path is a valid directory', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tacv-repo-test-'));
    try {
      await expect(validateRepoPath(tmpDir)).resolves.toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('skips validation for empty or current-directory path', async () => {
    await expect(validateRepoPath('.')).resolves.toBeUndefined();
    await expect(validateRepoPath('')).resolves.toBeUndefined();
  });
});
