import type { WorkflowState } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.flakiness');

export async function flakinessCheckImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  const cfg = deps.config.flakiness;
  if (!cfg.enabled) return { ...state, currentPhase: 'TEST_VALIDITY_REVIEW' };

  const failures = state.verifierVerdict?.testFailures ?? [];
  if (failures.length === 0) return { ...state, currentPhase: 'TEST_VALIDITY_REVIEW' };

  const langId = state.task.languageIds[0] ?? 'typescript';
  const plugin = deps.pluginRegistry.get(langId);
  const testPattern = plugin.getSyntaxInfo().testFilePattern;
  const suspectFiles = [...new Set(
    failures.map(f => f.file).filter((f): f is string => Boolean(f) && testPattern.test(f)),
  )];

  if (suspectFiles.length === 0) return { ...state, currentPhase: 'TEST_VALIDITY_REVIEW' };

  log.info('flakiness.start', { suspectFiles: suspectFiles.length, runs: cfg.runCount });

  const flakyTests: Array<{ testFile: string; passRate: number; runCount: number }> = [];

  for (const testFile of suspectFiles.slice(0, 5)) { // cap at 5 files
    const runs: boolean[] = [];
    for (let i = 0; i < cfg.runCount; i++) {
      const passed = await plugin.runAcceptanceTests(deps.repoPath, [testFile], { timeout: 30_000 })
        .then(r => r.passed)
        .catch(() => false);
      runs.push(passed);
    }
    const passRate = runs.filter(Boolean).length / runs.length;
    if (passRate > 0 && passRate < cfg.passThreshold) {
      flakyTests.push({ testFile, passRate, runCount: cfg.runCount });
      log.warn('flakiness.flaky_test_detected', { testFile, passRate: (passRate * 100).toFixed(0) + '%', runs: cfg.runCount });
    }
  }

  if (flakyTests.length > 0) {
    return {
      ...state,
      currentPhase: 'TEST_VALIDITY_REVIEW',
      flakinessReport: { flakyTests, detectedAt: state.correctionCycle.attemptCount },
      workflowAuditTrail: [...state.workflowAuditTrail, {
        timestampMs: Date.now(), node: 'flakiness_check',
        decision: 'flaky_tests_detected',
        keyValues: { count: flakyTests.length, files: flakyTests.map(f => f.testFile) },
      }],
    };
  }

  log.info('flakiness.no_flakiness_detected');
  return { ...state, currentPhase: 'TEST_VALIDITY_REVIEW' };
}
