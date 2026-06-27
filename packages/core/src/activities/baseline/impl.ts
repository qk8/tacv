import type { WorkflowState, BaselineTestResult } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.baseline');

/**
 * Baseline Verification — runs BEFORE the correction loop.
 *
 * Verifies that the existing test suite is green BEFORE we touch any code.
 * This catches "tests were already broken" early, preventing the agent from
 * burning its entire budget trying to fix pre-existing failures it didn't cause.
 *
 * Improvement over TACV original: TACV had no such check; the agent would
 * silently inherit broken tests and blame its own (correct) changes.
 */
export async function baselineVerificationImpl(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<WorkflowState> {
  if (!deps.config.baseline.enabled) {
    log.info('baseline.skipped_disabled');
    return { ...state, currentPhase: 'VALUE_NODE' };
  }

  log.info('baseline.start', { taskId: state.taskId, mode: state.task.mode });

  const langId  = state.task.languageIds[0] ?? 'typescript';
  const plugin  = deps.pluginRegistry.get(langId);
  const startMs = Date.now();

  let testResult: Awaited<ReturnType<typeof plugin.runProtectionTests>>;
  try {
    testResult = await plugin.runProtectionTests(deps.repoPath, {
      timeout: deps.config.testTimeoutMs,
    });
  } catch (err) {
    log.warn('baseline.test_run_failed', { error: String(err) });
    // If we can't run tests at all, skip gracefully — don't block the workflow
    return {
      ...state,
      currentPhase: 'VALUE_NODE',
      workflowAuditTrail: [...state.workflowAuditTrail, {
        timestampMs: Date.now(), node: 'baseline_verification',
        decision: 'skipped_test_run_error',
        keyValues: { error: String(err) },
      }],
    };
  }

  const baseline: BaselineTestResult = {
    passed:       testResult.passed,
    failureCount: testResult.failures.length,
    failures:     testResult.failures,
    durationMs:   Date.now() - startMs,
    ranAt:        startMs,
  };

  log.info('baseline.complete', {
    passed: baseline.passed,
    failures: baseline.failureCount,
    durationMs: baseline.durationMs,
  });

  // If baseline fails AND failFast is enabled, escalate immediately to HITL.
  // No point starting the correction loop for failures we didn't cause.
  const shouldEscalate = !baseline.passed && deps.config.baseline.failFast;
  const nextPhase = shouldEscalate ? 'HITL_ESCALATION' : 'VALUE_NODE';

  if (shouldEscalate) {
    log.warn('baseline.escalating_to_hitl', {
      failures: baseline.failureCount,
      hint: 'Tests were already failing before agent started. Fix baseline first.',
    });
  }

  return {
    ...state,
    currentPhase:       nextPhase,
    baselineTestResult: baseline,
    workflowAuditTrail: [...state.workflowAuditTrail, {
      timestampMs: Date.now(), node: 'baseline_verification',
      decision:   shouldEscalate ? 'baseline_failed_escalating' : 'baseline_passed',
      keyValues:  { passed: baseline.passed, failures: baseline.failureCount },
    }],
  };
}
