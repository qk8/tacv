/**
 * Continuous (per-file) verification.
 *
 * ── Problem this replaces ───────────────────────────────────────────────────
 * The staged verifier in `verification/stages.ts` (type-check → tests → API →
 * mutation → visual) is a genuine improvement over a single monolithic
 * verifier, but it still only runs after the actor has finished writing
 * every file for the cycle. If a cycle touches 10 files and 3 of them have
 * issues, all 10 changes are discovered to have a problem only once the
 * whole cycle is "done" — the entire cycle's work is rejected as a unit, and
 * the actor's next turn starts from a cold context rather than the live
 * context it had while writing the file that actually broke something.
 *
 * ── What this module provides ───────────────────────────────────────────────
 * `verifyFile` checks ONE file as soon as it is written: type-check first
 * (cheapest), and only if that passes, the blast-radius-selected tests
 * affected by that specific file (via the existing
 * `ICodeGraphProvider.selectAffectedTests`) — never the full suite.
 * `runContinuousVerification` runs this across a sequence of diffs and
 * stops at the FIRST failing file rather than always checking every file in
 * the batch — true fail-fast, so a problem in file 2 of 10 is caught and can
 * be fed back to the implementor before files 3–10 are even attempted in a
 * doomed cycle. `buildInlineFeedback` renders a single result as a short,
 * specific message ("the change to X broke N tests in Y") suitable for
 * injecting into the SAME agent turn that just wrote the file, turning the
 * cycle from "write everything, verify once" into "write, verify, adjust,
 * continue."
 */

import type { DiffEntry, TestFailure } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import type { LintViolation } from '@tacv/language-plugins-base';

export interface FileVerificationResult {
  readonly filePath: string;
  readonly typeCheckOk: boolean;
  readonly typeErrors: LintViolation[];
  readonly affectedTestFiles: string[];
  readonly testsOk: boolean | null;
  readonly testFailures: TestFailure[];
}

export async function verifyFile(
  diff: DiffEntry,
  knownTestFiles: string[],
  deps: ActivityDeps,
): Promise<FileVerificationResult> {
  const plugin = deps.pluginRegistry.getForFile(diff.filePath) ?? deps.pluginRegistry.get(diff.language);
  const lint = await plugin.typeCheck(deps.repoPath, [diff.filePath]);
  const typeCheckOk = lint.violations.length === 0;

  // Fail fast: code that doesn't even compile gets no test run wasted on it.
  if (!typeCheckOk) {
    return {
      filePath: diff.filePath, typeCheckOk: false, typeErrors: lint.violations,
      affectedTestFiles: [], testsOk: null, testFailures: [],
    };
  }

  const affectedTestFiles = await deps.codeGraph.selectAffectedTests([diff.filePath], knownTestFiles);
  if (affectedTestFiles.length === 0) {
    return { filePath: diff.filePath, typeCheckOk: true, typeErrors: [], affectedTestFiles: [], testsOk: null, testFailures: [] };
  }

  const testResult = await plugin.runProtectionTests(deps.repoPath, { testFiles: affectedTestFiles });
  return {
    filePath: diff.filePath, typeCheckOk: true, typeErrors: [],
    affectedTestFiles, testsOk: testResult.passed, testFailures: testResult.failures,
  };
}

export interface ContinuousVerificationOutcome {
  readonly results: FileVerificationResult[];
  readonly firstFailureIndex: number | null;
  readonly allOk: boolean;
}

export async function runContinuousVerification(
  diffs: DiffEntry[],
  knownTestFiles: string[],
  deps: ActivityDeps,
): Promise<ContinuousVerificationOutcome> {
  const results: FileVerificationResult[] = [];
  let firstFailureIndex: number | null = null;

  for (let i = 0; i < diffs.length; i++) {
    const result = await verifyFile(diffs[i]!, knownTestFiles, deps);
    results.push(result);
    const failed = !result.typeCheckOk || result.testsOk === false;
    if (failed) {
      firstFailureIndex = i;
      break; // stop verifying the rest of this cycle's files — fail fast
    }
  }

  return { results, firstFailureIndex, allOk: firstFailureIndex === null };
}

/** Renders one result as a short, specific message for the implementor's next turn. */
export function buildInlineFeedback(result: FileVerificationResult): string {
  const fileName = result.filePath.split('/').pop() ?? result.filePath;
  if (!result.typeCheckOk) {
    const first = result.typeErrors[0];
    return `Type error in ${fileName}${first ? `: ${first.message}` : ''}. Fix this before continuing to the next file.`;
  }
  if (result.testsOk === false) {
    const testFileName = result.affectedTestFiles[0]?.split('/').pop() ?? 'affected tests';
    return `The change to ${fileName} broke ${result.testFailures.length} test(s) in ${testFileName}.`;
  }
  return `${fileName}: type-check passed${result.affectedTestFiles.length ? `, ${result.affectedTestFiles.length} affected test(s) passed` : ''}.`;
}
