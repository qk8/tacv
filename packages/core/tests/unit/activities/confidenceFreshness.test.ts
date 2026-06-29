import { describe, it, expect } from 'vitest';
import { computeConfidenceScore } from '../../../src/state/transitions.js';
import { createInitialState } from '../../../src/state/schemas.js';
import type { WorkflowState } from '../../../src/state/schemas.js';
import type { WorkflowConfig } from '../../../src/config/index.js';
import { stubConfig } from '../../helpers/stubDeps.js';

const task = { taskId: 'conf1', description: 'Test confidence freshness', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('Bug 8: Confidence score staleness', () => {
  it('recomputes confidence after critical critic findings', () => {
    const baseState = createInitialState(task) as WorkflowState;
    const config = stubConfig as WorkflowConfig;

    // Base confidence with no findings
    const baseConf = computeConfidenceScore(baseState, config);

    // Add critical critic findings
    const withFindings = {
      ...baseState,
      criticFindings: [
        { critic: 'security', severity: 'critical', file: 'src/foo.ts', line: 1, ruleId: 'INJECTION', message: 'SQL injection', resolutionHint: 'Use parameterized queries' },
        { critic: 'consistency', severity: 'critical', file: 'src/bar.ts', line: 5, ruleId: 'BAD_PATTERN', message: 'Bad pattern', resolutionHint: 'Fix pattern' },
      ],
      verifierVerdict: {
        testResult: 'FAIL' as const,
        testFailures: [{ file: 'src/Bar.test.ts', message: 'fail', line: 1 }],
        apiFailures: [], mutationFailures: [], typeCheckFailures: [], visualFailures: [],
        blockedByCritic: false, confidenceScore: 0,
      },
    } as WorkflowState;

    const freshConf = computeConfidenceScore(withFindings, config);

    // Fresh confidence should be lower due to critical findings
    expect(freshConf).toBeLessThan(baseConf);
    // Each critical finding reduces confidence by 0.05
    expect(freshConf).toBeLessThanOrEqual(baseConf - 0.1);
  });

  it('detects stale confidence when computed before critics', () => {
    const baseState = createInitialState(task) as WorkflowState;
    const config = stubConfig as WorkflowConfig;

    // Confidence computed at start of cycle (before critics)
    const staleConf = computeConfidenceScore(baseState, config);

    // After critics add critical findings, the stale score is no longer accurate
    const withFindings = {
      ...baseState,
      criticFindings: [
        { critic: 'security', severity: 'critical', file: 'src/foo.ts', line: 1, ruleId: 'INJECTION', message: 'SQL injection', resolutionHint: 'Fix' },
      ],
      verifierVerdict: {
        testResult: 'FAIL' as const,
        testFailures: [], apiFailures: [], mutationFailures: [], typeCheckFailures: [], visualFailures: [],
        blockedByCritic: false, confidenceScore: 0,
      },
    } as WorkflowState;

    const freshConf = computeConfidenceScore(withFindings, config);

    // Stale confidence is higher than what it should be
    expect(staleConf).toBeGreaterThan(freshConf);
  });
});
