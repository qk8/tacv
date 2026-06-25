import type { WorkflowState, TestFaultAssessment } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { isTestFile } from '../critics/testPreservationCritic.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.test_validity');

export async function testValidityReviewImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  const config = deps.config.testValidity;
  if (!config.enabled) return { ...state, currentPhase: 'ACTOR' };

  const failures = state.verifierVerdict?.testFailures ?? [];
  if (failures.length === 0) return { ...state, currentPhase: 'ACTOR' };

  log.info('test_validity.start', { cycle: state.correctionCycle.attemptCount, failures: failures.length });

  // Check if failures appear to originate in test files rather than production code
  const stack = state.debugObservations?.prunedStack ?? [];
  const testOriginFailures = failures.filter(f => {
    const failFile = f.file ?? '';
    // Failure in a test file, or stack trace entirely inside test files
    return isTestFile(failFile) || (stack.length > 0 && stack.every(fr => isTestFile(fr.file)));
  });

  const diffContent = state.diffProposal?.diffs.filter(d => !isTestFile(d.filePath)).map(d => d.diffContent.slice(0,600)).join('\n---\n') ?? '';

  let assessment: TestFaultAssessment;
  try {
    assessment = await deps.extractor.extract(
      `A coding agent has made ${state.correctionCycle.attemptCount} consecutive failed attempts.
The implementation passes all static analysis and critics.

Task requirement: ${state.task.description}

Test failures:
${failures.map(f => `- [${f.testName ?? 'unnamed'}] ${f.message}`).join('\n')}

Implementation diff (production code only):
${diffContent.slice(0, 1500)}

Test files involved:
${state.diffProposal?.testFilePaths.join('\n') ?? '(none)'}

Determine whether these failures indicate:
A) IMPLEMENTATION_FAULT — the production code is genuinely wrong
B) TEST_FAULT — the test assertion does not correctly describe the expected behaviour
C) AMBIGUOUS — cannot determine from available information

For TEST_FAULT, provide the current assertion and a corrected version.
Common test fault signs: inverted assertions (toBeNull vs toBeDefined), wrong expected values,
testing wrong method, too-strict assertions on dynamic values.`,
      TestFaultAssessment,
      { system: 'You distinguish implementation bugs from test specification errors. Be conservative — only call TEST_FAULT when confident.', model: config.model },
    );
  } catch (err) {
    log.warn('test_validity.extract_failed', { error: String(err) });
    return { ...state, currentPhase: 'ACTOR' };
  }

  log.info('test_validity.assessment', {
    verdict: assessment.verdict, confidence: assessment.confidence,
    affectedTests: assessment.affectedTests.length,
  });

  if (assessment.verdict === 'TEST_FAULT' && assessment.confidence >= 0.7) {
    log.warn('test_validity.test_fault_detected', { tests: assessment.affectedTests, confidence: assessment.confidence });
    return {
      ...state,
      currentPhase: 'HITL_ESCALATION',
      testValidityFlag: {
        suspected: true,
        affectedTests: assessment.affectedTests,
        proposedFixes: assessment.proposedFixes,
        confidence: assessment.confidence,
        detectedAtCycle: state.correctionCycle.attemptCount,
      },
      workflowAuditTrail: [...state.workflowAuditTrail, {
        timestampMs: Date.now(), node: 'test_validity_review',
        decision: 'test_fault_escalation',
        keyValues: { verdict: assessment.verdict, confidence: assessment.confidence, tests: assessment.affectedTests },
      }],
    };
  }

  // IMPLEMENTATION_FAULT or AMBIGUOUS → resume normal correction
  return { ...state, currentPhase: 'ACTOR' };
}
