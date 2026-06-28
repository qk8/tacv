import type { WorkflowState, TestFailure, AstDiffResult } from '../../state/schemas.js';
import { withAuditEntry } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { computeConfidenceScore } from '../../state/transitions.js';
import { isFrontendModule, isBackendModule } from '../critics/shared.js';
import { createLogger } from '../../observability/logger.js';
import * as path from 'node:path';

const log = createLogger('tacv.verifier');

export async function verifierImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  if (state.verifierVerdict?.blockedByCritic) {
    log.info('verifier.skipped_blocked_by_critic');
    return state;
  }
  if (!state.diffProposal) return { ...state, currentPhase: 'VERIFIER' };

  log.info('verifier.start', { attempt: state.correctionCycle.attemptCount });

  const langId  = state.task.languageIds[0] ?? 'typescript';
  const plugin  = deps.pluginRegistry.get(langId);
  const changed = state.diffProposal.diffs.map(d => d.filePath);

  // ── Step 0: AST diff (fast, no Docker) ──────────────────────────────────
  let astDiff: AstDiffResult | null = null;
  try {
    astDiff = await deps.codeGraph.computeAstDiff(deps.repoPath, state.diffProposal);
    log.info('verifier.ast_diff', { semantic: astDiff.semanticChanges.length, breaking: astDiff.breakingChangeCount });
  } catch (err) { log.warn('verifier.ast_diff_failed', { error: String(err) }); }

  // ── Step 1: Type check (fast, no Docker) ─────────────────────────────────
  const typeResult = await plugin.typeCheck(deps.repoPath, changed);
  if (typeResult.violations.length > 0) {
    return buildFail(state, deps, 'TYPE_CHECK_FAILED',
      typeResult.violations.map(v => ({ message: v.message, testName: v.ruleId })),
      astDiff, 'AMBIGUOUS');
  }

  // ── Step 2: Test selection — FULL suite by default, incremental only if opted-in ──
  // Default: run ALL protection tests. Incremental is opt-in because it can miss regressions.
  const allProtectionTests = await discoverAllTests(deps.repoPath, langId);

  const selectedTests = deps.config.incrementalTesting.enabled
    ? await deps.codeGraph.selectAffectedTests(changed, allProtectionTests)
    : allProtectionTests;

  if (deps.config.incrementalTesting.enabled && selectedTests.length < allProtectionTests.length) {
    log.warn('verifier.incremental_active', {
      total: allProtectionTests.length, selected: selectedTests.length,
      hint: 'Full suite not run — regressions outside blast radius may be missed.',
    });
  } else {
    log.info('verifier.full_suite', { total: selectedTests.length });
  }

  // ── Step 3: Protection tests (regression guard) ───────────────────────────
  const protResult = await plugin.runProtectionTests(deps.repoPath, { testFiles: selectedTests, timeout: deps.config.testTimeoutMs });
  if (!protResult.passed) {
    return buildFail(state, deps, 'PROTECTION_TESTS_FAILED', protResult.failures, astDiff, 'FIX_IMPL');
  }

  // ── Step 4: Acceptance tests (TDD new tests) ──────────────────────────────
  const acceptFiles = state.diffProposal.testFilePaths;
  if (acceptFiles.length > 0) {
    const accResult = await plugin.runAcceptanceTests(deps.repoPath, acceptFiles, { timeout: deps.config.testTimeoutMs });
    if (!accResult.passed) {
      return buildFail(state, deps, 'ACCEPTANCE_TESTS_FAILED', accResult.failures, astDiff, 'FIX_TEST');
    }
    if (accResult.coverageReport) {
      const minLine = getMutationThreshold(deps, acceptFiles[0] ?? '');
      if (accResult.coverageReport.lines < minLine) {
        return buildFail(state, deps, 'COVERAGE_BELOW_THRESHOLD',
          [{ message: `Line coverage ${accResult.coverageReport.lines.toFixed(1)}% < minimum ${minLine}%` }],
          astDiff, 'FIX_TEST');
      }
    }
  }

  // ── Step 5: API tests (backend) ───────────────────────────────────────────
  let apiTestResult = null;
  if (isBackendModule(state.task.moduleType)) {
    apiTestResult = await plugin.runApiTests(deps.repoPath);
    if (!apiTestResult.passed) {
      return buildFail(state, deps, 'API_TESTS_FAILED',
        apiTestResult.failures.map(f => ({ testName: f.testName, message: f.message })),
        astDiff, 'FIX_IMPL');
    }
  }

  // ── Step 6: Mutation testing (conditional) ────────────────────────────────
  let mutationResult = null;
  if (deps.config.mutation.enabled && acceptFiles.length > 0 && acceptFiles.length <= deps.config.mutation.maxTestFiles) {
    mutationResult = await plugin.runMutationTests(deps.repoPath, acceptFiles);
    const threshold = getMutationScoreThreshold(deps, acceptFiles[0] ?? '');
    if (mutationResult.mutationScore < threshold) {
      return buildFail(state, deps, 'MUTATION_SCORE_TOO_LOW',
        [{ message: `Mutation score ${mutationResult.mutationScore.toFixed(1)}% < minimum ${threshold}%`, testName: 'mutation_testing' }],
        astDiff, 'FIX_TEST');
    }
  }

  // ── Step 7: Visual tests (frontend) ──────────────────────────────────────
  if (isFrontendModule(state.task.moduleType) && deps.config.visual.enabled) {
    try {
      const { runVisualTests } = await import('./visualTests.js');
      const visualResult = await runVisualTests(state, deps);
      if (!visualResult.passed && !visualResult.baselineUpdated) {
        const fails = visualResult.diffs.filter(d => !d.passed);
        return buildFail(state, deps, 'VISUAL_REGRESSION',
          fails.map(f => ({ testName: `Visual:${f.testName}@${f.viewport}`, message: `${f.pixelDiffPct.toFixed(2)}% pixel diff` })),
          astDiff, 'FIX_IMPL');
      }
      return buildPass(state, deps, astDiff, mutationResult, apiTestResult, visualResult);
    } catch (err) { log.warn('verifier.visual_failed', { error: String(err) }); }
  }

  return buildPass(state, deps, astDiff, mutationResult, apiTestResult, null);
}

function getMutationThreshold(deps: ActivityDeps, testFile: string): number {
  for (const override of deps.config.mutation.overrides ?? []) {
    if (testFile.includes(override.pattern.replace('**', ''))) return override.minimumScore;
  }
  return deps.config.coverage.minimumLineCoverage;
}

function getMutationScoreThreshold(deps: ActivityDeps, testFile: string): number {
  for (const override of deps.config.mutation.overrides ?? []) {
    if (testFile.includes(override.pattern.replace('**', '').replace('*', ''))) return override.minimumScore;
  }
  return deps.config.mutation.minimumScore;
}

function buildFail(state: WorkflowState, deps: ActivityDeps, reason: string, failures: TestFailure[], astDiff: AstDiffResult | null, diagnostic: 'FIX_IMPL'|'FIX_TEST'|'AMBIGUOUS'): WorkflowState {
  const newConf = Math.max(0, state.confidenceScore - 0.12);
  log.warn('verifier.fail', { reason, failures: failures.length });
  return withAuditEntry({
    ...state,
    confidenceScore: newConf,
    verifierVerdict: { testResult: 'FAIL', diagnostic, testFailures: failures.slice(0, 10), blockedByCritic: false, confidenceScore: newConf },
    astDiff,
  }, { node: 'verifier', decision: `fail_${reason.toLowerCase()}`, keyValues: { reason, failures: failures.length } });
}

function buildPass(state: WorkflowState, _deps: ActivityDeps, astDiff: AstDiffResult | null,
  mutationResult: import('../../state/schemas.js').MutationResult | null,
  apiTestResult:  import('../../state/schemas.js').ApiTestResult | null,
  visualResult:   import('../../state/schemas.js').VisualTestResult | null): WorkflowState {
  log.info('verifier.pass', { attempt: state.correctionCycle.attemptCount });
  return withAuditEntry({
    ...state,
    verifierVerdict: { testResult: 'PASS', diagnostic: 'PASS', testFailures: [], blockedByCritic: false, confidenceScore: 1.0 },
    astDiff, mutationResult, apiTestResult, visualTestResult: visualResult,
  }, { node: 'verifier', decision: 'PASS', keyValues: { attempt: state.correctionCycle.attemptCount } });
}

async function discoverAllTests(repoPath: string, langId: string): Promise<string[]> {
  try {
    const { glob } = await import('glob');
    const patterns = langId === 'java'
      ? ['**/*Test.java', '**/*IT.java', '**/*Tests.java']
      : ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'];
    return await glob(patterns, { cwd: repoPath, ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/target/**'] });
  } catch { return []; }
}
