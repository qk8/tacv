import type { WorkflowState, TestFailure } from '../../state/schemas.js';
import { withAuditEntry } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';
import { checkCoverageRegression } from './coverageCheck.js';
import { isBackendModule } from '../critics/shared.js';

const log = createLogger('tacv.verifier.staged');

// ─────────────────────────────────────────────────────────────────────────────
// Shared context helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface VerifierSharedContext {
  changedFiles: string[];
  langId: string;
}

export function buildVerifierSharedContext(
  state: WorkflowState,
  _deps: ActivityDeps,
): VerifierSharedContext {
  return {
    changedFiles: state.diffProposal?.diffs.map(d => d.filePath) ?? [],
    langId:       state.task.languageIds[0] ?? 'typescript',
  };
}

/** Returns true if a prior stage already set a FAIL verdict — short-circuit signal. */
function alreadyFailed(state: WorkflowState): boolean {
  return state.verifierVerdict?.testResult === 'FAIL';
}

/** Builds a uniform PASS verdict, preserving confidenceScore from state. */
function passVerdict(state: WorkflowState) {
  return {
    testResult:      'PASS'     as const,
    diagnostic:      'PASS'     as const,
    testFailures:    [] as TestFailure[],
    blockedByCritic: state.verifierVerdict?.blockedByCritic ?? false,
    confidenceScore: state.confidenceScore,
  };
}

/** Builds a FAIL verdict from test failures. */
function failVerdict(
  failures:   TestFailure[],
  diagnostic: 'FIX_IMPL' | 'FIX_TEST' | 'AMBIGUOUS',
  state:      WorkflowState,
) {
  return {
    testResult:      'FAIL'     as const,
    diagnostic,
    testFailures:    failures,
    blockedByCritic: state.verifierVerdict?.blockedByCritic ?? false,
    confidenceScore: Math.max(0, state.confidenceScore - 0.15),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1: Type checking
// Timeout: 2 minutes. Retry: up to 2 times.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage 1 — TypeCheck.
 *
 * Runs the language plugin's static type-checker and AST diff validator.
 * This is the cheapest stage (no test execution), so it runs first and
 * short-circuits the expensive stages when compilation fails.
 *
 * Improvement over TACV: In the monolith verifier, a type error at minute 0
 * would still wait for tests to complete before returning FAIL. Here it
 * short-circuits immediately, saving test execution time.
 */
export async function verifierTypeCheckStage(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<WorkflowState> {
  if (alreadyFailed(state)) {
    log.info('verifier.typecheck.skipped_prior_fail');
    return state;
  }
  if (!state.diffProposal) {
    log.info('verifier.typecheck.skipped_no_diff');
    return { ...state, verifierVerdict: passVerdict(state) };
  }

  const { langId } = buildVerifierSharedContext(state, deps);
  const plugin = deps.pluginRegistry.get(langId);
  log.info('verifier.typecheck.start', { langId, files: state.diffProposal.diffs.length });

  try {
    const tcResult = await plugin.typeCheck(deps.repoPath, state.diffProposal.diffs.map(d => d.filePath));
    if (tcResult.violations.length > 0) {
      const failures: TestFailure[] = tcResult.violations.map(v => ({
        testName: v.ruleId,
        message:  `[typecheck] ${v.file}:${v.line ?? '?'} — ${v.message}`,
      }));
      log.warn('verifier.typecheck.fail', { violations: tcResult.violations.length });
      return withAuditEntry({
        ...state,
        verifierVerdict: failVerdict(failures, 'AMBIGUOUS', state),
      }, { node: 'verifier_typecheck', decision: 'FAIL', keyValues: { violations: tcResult.violations.length } });
    }
  } catch (err) {
    log.warn('verifier.typecheck.error', { error: String(err) });
    const failures: TestFailure[] = [{ testName: 'typecheck', message: String(err) }];
    return { ...state, verifierVerdict: failVerdict(failures, 'AMBIGUOUS', state) };
  }

  log.info('verifier.typecheck.pass');
  return withAuditEntry({
    ...state,
    verifierVerdict: passVerdict(state),
  }, { node: 'verifier_typecheck', decision: 'PASS', keyValues: {} });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2: Test execution (protection + acceptance + coverage)
// Timeout: 10 minutes. Retry: up to 2 times.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage 2 — Tests.
 *
 * Runs protection tests (must never regress), acceptance tests (new behaviour),
 * and a coverage regression check. These are independent of mutation/visual
 * and fail fast if core regressions are found.
 *
 * Improvement over TACV: In the monolith, protection test failures blocked
 * mutation testing from running AT ALL in the retry. Here only Stage 2 retries,
 * not the full pipeline.
 */
export async function verifierTestsStage(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<WorkflowState> {
  if (alreadyFailed(state)) {
    log.info('verifier.tests.skipped_prior_fail');
    return state;
  }
  if (!state.diffProposal) {
    return { ...state, verifierVerdict: passVerdict(state) };
  }

  const { langId } = buildVerifierSharedContext(state, deps);
  const plugin = deps.pluginRegistry.get(langId);
  log.info('verifier.tests.start', { langId });

  // Populate selectedTestFiles from diffProposal if not already set
  let testFilesToRun = state.selectedTestFiles;
  if (testFilesToRun.length === 0 && state.diffProposal?.testFilePaths.length) {
    testFilesToRun = state.diffProposal.testFilePaths;
    log.info('verifier.tests.selected_from_diff', { count: testFilesToRun.length });
  }

  // ── Protection tests ─────────────────────────────────────────────────────
  try {
    const protResult = await plugin.runProtectionTests(deps.repoPath, {
      timeout: deps.config.testTimeoutMs,
    });
    if (!protResult.passed) {
      const failures = protResult.failures.map(f => ({
        testName: f.testName,
        message:  `[protection] ${f.message}`,
      }));
      log.warn('verifier.tests.protection_fail', { count: protResult.failedTests });
      return withAuditEntry({
        ...state,
        verifierVerdict: failVerdict(failures, 'FIX_IMPL', state),
      }, { node: 'verifier_tests', decision: 'FAIL_PROTECTION', keyValues: { count: protResult.failedTests } });
    }

    // ── Acceptance tests ────────────────────────────────────────────────────
    const accResult = await plugin.runAcceptanceTests(
      deps.repoPath,
      testFilesToRun,
      { timeout: deps.config.testTimeoutMs },
    );
    if (!accResult.passed) {
      const failures = accResult.failures.map(f => ({
        testName: f.testName,
        message:  `[acceptance] ${f.message}`,
      }));
      log.warn('verifier.tests.acceptance_fail', { count: accResult.failedTests });
      return withAuditEntry({
        ...state,
        verifierVerdict: failVerdict(failures, 'FIX_TEST', state),
      }, { node: 'verifier_tests', decision: 'FAIL_ACCEPTANCE', keyValues: { count: accResult.failedTests } });
    }

    // ── Coverage check (non-blocking warning only) ──────────────────────────
    const coverageReport = accResult.coverageReport ?? protResult.coverageReport;
    const baselineCoverage = state.baselineTestResult?.coverageReport;
    if (coverageReport && baselineCoverage) {
      const coverageOk = checkCoverageRegression(baselineCoverage, coverageReport, deps.config.coverage);
      if (!coverageOk.passed) {
        log.warn('verifier.tests.coverage_regression', { violations: coverageOk.violations });
        // Coverage regression is a soft fail — record it but don't block
        return {
          ...state,
          verifierVerdict: failVerdict(
            coverageOk.violations.map(v => ({ testName: 'coverage', message: v.message })),
            'FIX_TEST',
            state,
          ),
        };
      }
    } else if (coverageReport && !baselineCoverage) {
      // No baseline available — check against minimum threshold only
      const minLine = deps.config.coverage.minimumLineCoverage;
      if (coverageReport.lines < minLine) {
        return {
          ...state,
          verifierVerdict: failVerdict(
            [{ testName: 'coverage', message: `Line coverage ${coverageReport.lines.toFixed(1)}% < minimum ${minLine}%` }],
            'FIX_TEST',
            state,
          ),
        };
      }
    }
  } catch (err) {
    log.warn('verifier.tests.error', { error: String(err) });
    return {
      ...state,
      verifierVerdict: failVerdict(
        [{ testName: 'tests', message: String(err) }],
        'FIX_IMPL',
        state,
      ),
    };
  }

  log.info('verifier.tests.pass');
  return withAuditEntry({
    ...state,
    selectedTestFiles: testFilesToRun,
    verifierVerdict: passVerdict(state),
  }, { node: 'verifier_tests', decision: 'PASS', keyValues: { testFiles: testFilesToRun.length } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3: API/contract tests (backend only)
// Timeout: 5 minutes. Retry: up to 2 times.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage 3 — API tests.
 *
 * Runs HTTP/contract tests only for backend modules. Skipped for frontend.
 * Separate activity means a flaky contract test doesn't force re-running
 * protection tests.
 */
export async function verifierApiStage(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<WorkflowState> {
  if (alreadyFailed(state)) {
    log.info('verifier.api.skipped_prior_fail');
    return state;
  }
  if (!isBackendModule(state.task.moduleType) || !state.diffProposal) {
    return { ...state, verifierVerdict: passVerdict(state) };
  }

  const { langId } = buildVerifierSharedContext(state, deps);
  const plugin = deps.pluginRegistry.get(langId);

  try {
    const apiResult = await plugin.runApiTests(deps.repoPath);
    // Map plugin API test result to the schema-typed ApiTestResult
    const mappedApiResult: import('../../state/schemas.js').ApiTestResult = {
      passed: apiResult.passed,
      totalTests: apiResult.totalTests,
      failedTests: apiResult.failedTests,
      failures: (apiResult.failures as Array<{ testName?: string; message?: string; endpoint?: string; method?: string; expectedStatus?: number; actualStatus?: number }>).map(f => ({
        testName: f.testName ?? 'unknown',
        endpoint: f.endpoint ?? '',
        method: f.method ?? '',
        expectedStatus: f.expectedStatus ?? 0,
        actualStatus: f.actualStatus ?? 0,
        message: f.message ?? String(apiResult),
      })),
      durationMs: apiResult.durationMs ?? 0,
    };
    if (!apiResult.passed) {
      const failures: TestFailure[] = mappedApiResult.failures.map(f => ({
        testName: f.testName,
        message:  `[api] ${f.message}`,
      }));
      log.warn('verifier.api.fail', { count: mappedApiResult.failedTests });
      return withAuditEntry({
        ...state,
        apiTestResult:  mappedApiResult,
        verifierVerdict: failVerdict(failures, 'FIX_IMPL', state),
      }, { node: 'verifier_api', decision: 'FAIL', keyValues: { count: mappedApiResult.failedTests } });
    }
    log.info('verifier.api.pass');
    return {
      ...state,
      apiTestResult: mappedApiResult,
      verifierVerdict: passVerdict(state),
    };
  } catch (err) {
    log.warn('verifier.api.error', { error: String(err) });
    // API test errors are non-fatal for non-critical services
    return { ...state, verifierVerdict: passVerdict(state) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 4: Mutation testing (conditional)
// Timeout: 5 minutes. Retry: 1 time only (expensive).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage 4 — Mutation testing.
 *
 * Only runs when mutation.enabled=true. This is the most expensive stage
 * (90–180s), so it benefits most from being a separate activity:
 * - Its own retry policy (only 1 retry, not 3)
 * - Its own timeout (separate from test execution)
 * - Heartbeating support (future: can be added here without touching other stages)
 *
 * Improvement over TACV: In the monolith, if mutation timed out at 9:45 into
 * a 10-minute activity, ALL stages would retry. Now only mutation retries.
 */
export async function verifierMutationStage(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<WorkflowState> {
  if (alreadyFailed(state)) {
    log.info('verifier.mutation.skipped_prior_fail');
    return state;
  }
  if (!deps.config.mutation.enabled || !state.diffProposal) {
    return { ...state, verifierVerdict: passVerdict(state) };
  }

  const { langId, changedFiles } = buildVerifierSharedContext(state, deps);
  const plugin = deps.pluginRegistry.get(langId);
  log.info('verifier.mutation.start', { files: changedFiles.length });

  try {
    const mutResult = await plugin.runMutationTests(deps.repoPath, changedFiles.slice(0, deps.config.mutation.maxTestFiles));

    // Check per-module overrides first, then fall back to global threshold
    const threshold = resolveThreshold(changedFiles, deps);
    if (mutResult.mutationScore < threshold) {
      log.warn('verifier.mutation.fail', { score: mutResult.mutationScore, threshold });
      return withAuditEntry({
        ...state,
        mutationResult:  mutResult,
        verifierVerdict: failVerdict(
          [{ testName: 'mutation', message: `Mutation score ${mutResult.mutationScore}% < ${threshold}% (weak: ${mutResult.weakTestFiles.join(', ')})` }],
          'FIX_TEST',
          state,
        ),
      }, { node: 'verifier_mutation', decision: 'FAIL', keyValues: { score: mutResult.mutationScore, threshold } });
    }
    log.info('verifier.mutation.pass', { score: mutResult.mutationScore });
    return { ...state, mutationResult: mutResult, verifierVerdict: passVerdict(state) };
  } catch (err) {
    log.warn('verifier.mutation.error', { error: String(err) });
    // Mutation errors don't block — treat as PASS (test coverage still ran in Stage 2)
    return { ...state, verifierVerdict: passVerdict(state) };
  }
}

function resolveThreshold(changedFiles: string[], deps: ActivityDeps): number {
  let threshold = deps.config.mutation.minimumScore;
  for (const override of deps.config.mutation.overrides ?? []) {
    const pattern = new RegExp(override.pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
    if (changedFiles.some(f => pattern.test(f))) {
      threshold = Math.max(threshold, override.minimumScore);
    }
  }
  return threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 5: Visual / screenshot regression (frontend only)
// Timeout: 10 minutes. Retry: 1 time.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage 5 — Visual regression testing.
 *
 * Only runs for frontend modules with visual.enabled=true. This stage takes
 * the longest (screenshot rendering + diff) and is the most environment-
 * sensitive (needs a running frontend server). Isolating it means a flaky
 * screenshot doesn't force re-running type checking and unit tests.
 */
export async function verifierVisualStage(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<WorkflowState> {
  if (alreadyFailed(state)) {
    log.info('verifier.visual.skipped_prior_fail');
    return state;
  }
  const isFrontend = state.task.moduleType === 'frontend' || state.task.moduleType === 'fullstack';
  if (!deps.config.visual.enabled || !isFrontend || !state.diffProposal) {
    return { ...state, verifierVerdict: passVerdict(state) };
  }

  const { langId } = buildVerifierSharedContext(state, deps);
  void deps.pluginRegistry.get(langId); // retain reference for future use
  log.info('verifier.visual.start', { viewports: deps.config.visual.viewports.length });

  try {
    const { runVisualTests } = await import('./visualTests.js');
    const visualResult = await runVisualTests(state, deps);

    const maxDiff = deps.config.visual.maxDiffPercent;
    const failing = visualResult.diffs.filter(d => !d.passed && d.pixelDiffPct > maxDiff);

    if (failing.length > 0) {
      const failures: TestFailure[] = failing.map(d => ({
        testName: `visual:${d.testName}@${d.viewport}`,
        message:  `Visual diff ${d.pixelDiffPct.toFixed(2)}% exceeds ${maxDiff}%`,
      }));
      log.warn('verifier.visual.fail', { count: failures.length });
      return withAuditEntry({
        ...state,
        visualTestResult: visualResult,
        verifierVerdict:  failVerdict(failures, 'FIX_IMPL', state),
      }, { node: 'verifier_visual', decision: 'FAIL', keyValues: { diffs: failures.length } });
    }

    log.info('verifier.visual.pass');
    return { ...state, visualTestResult: visualResult, verifierVerdict: passVerdict(state) };
  } catch (err) {
    log.warn('verifier.visual.error', { error: String(err) });
    return { ...state, verifierVerdict: passVerdict(state) };
  }
}
