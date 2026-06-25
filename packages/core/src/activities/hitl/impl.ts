import type { WorkflowState } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import type { EscalationReason } from '../../state/transitions.js';
import { createLogger } from '../../observability/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const log = createLogger('tacv.hitl');

export async function hitlImpl(state: WorkflowState, reason: EscalationReason, deps: ActivityDeps): Promise<WorkflowState> {
  const escId  = `esc-${Date.now()}-${state.taskId}`;
  const hoursSinceStart = (Date.now() - state.workflowStartMs) / 3_600_000;
  const budgetAtEscalation = state.cumulativeCostUsd;
  const budgetRemaining    = deps.config.tokenBudget.criticalDollar - budgetAtEscalation;
  const budgetPercentUsed  = (budgetAtEscalation / deps.config.tokenBudget.criticalDollar) * 100;

  // Staleness warning
  const stalenessWarning = hoursSinceStart > 8
    ? `⚠️ STALENESS RISK: This workflow has been running for ${hoursSinceStart.toFixed(0)} hours. ` +
      `Review whether the codebase has changed since this session started before resuming.`
    : null;

  // Budget warning — if too little budget left, don't allow resume
  const budgetWarning = budgetRemaining < deps.config.tokenBudget.criticalDollar * 0.15
    ? `⚠️ LOW BUDGET: Only $${budgetRemaining.toFixed(2)} remaining (${(100 - budgetPercentUsed).toFixed(0)}%). ` +
      `Consider starting a fresh session with your guidance embedded in the initial task description rather than resuming.`
    : null;

  // Test-fault special escalation payload
  const testFaultInfo = state.testValidityFlag?.suspected
    ? {
        testFaultSuspected: true,
        affectedTests:      state.testValidityFlag.affectedTests,
        confidence:         state.testValidityFlag.confidence,
        proposedFixes:      state.testValidityFlag.proposedFixes,
        instruction:        'The workflow suspects a TEST FAULT (not an implementation bug). Review proposed test corrections and either approve them or provide guidance.',
      }
    : null;

  // Flakiness info
  const flakinessInfo = state.flakinessReport?.flakyTests.length
    ? {
        flakyTestsDetected: true,
        flakyTests: state.flakinessReport.flakyTests,
        instruction: 'Flaky tests detected. They may need to be fixed or have their assertions made deterministic.',
      }
    : null;

  const payload = {
    escId,
    taskId:          state.taskId,
    sessionId:       state.sessionId,
    reason,
    taskDescription: state.task.description,
    attempt:         state.correctionCycle.attemptCount,
    costUsd:         budgetAtEscalation,
    budgetRemaining,
    budgetPercentUsed: budgetPercentUsed.toFixed(0) + '%',
    confidenceScore: state.confidenceScore,
    stalenessWarning,
    budgetWarning,
    testFaultInfo,
    flakinessInfo,
    // Include prior guidance so human knows what was already tried
    priorGuidance:   state.hitlPriorGuidance ?? null,
    auditTrail:      state.workflowAuditTrail.slice(-20),
    lastFailures:    state.verifierVerdict?.testFailures.slice(0, 5) ?? [],
    criticFindings:  state.criticFindings.filter(f => f.severity === 'critical').slice(0, 10),
    timestamp:       new Date().toISOString(),
    resumeInstructions: [
      `To approve: tacv resume --workflow-id ${state.taskId} --action approve`,
      `To override with guidance: tacv resume --workflow-id ${state.taskId} --action override --guidance "your guidance here"`,
      `To abort: tacv resume --workflow-id ${state.taskId} --action reject`,
    ],
  };

  // Persist to disk (best-effort — interrupt() fires regardless)
  try {
    const dir = path.join(deps.repoPath, '.workflow', 'escalations');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${escId}.json`), JSON.stringify(payload, null, 2));
    log.warn('hitl.payload_written', { escId, reason, path: dir });
  } catch (err) {
    log.error('hitl.payload_write_failed', { escId, error: String(err) });
  }

  log.warn('hitl.escalating', {
    reason, escId, attempt: state.correctionCycle.attemptCount,
    costUsd: budgetAtEscalation.toFixed(4), budgetRemaining: budgetRemaining.toFixed(2),
    hasTestFault: Boolean(testFaultInfo), hasFlakiness: Boolean(flakinessInfo),
  });

  return {
    ...state,
    currentPhase: 'HITL_ESCALATION',
    escalationPayload: payload,
    hitlBudgetAtEscalation: budgetAtEscalation,
    workflowAuditTrail: [...state.workflowAuditTrail, {
      timestampMs: Date.now(), node: 'hitl_escalation',
      decision: `escalating_${reason}`,
      keyValues: { escId, reason, costUsd: budgetAtEscalation, budgetRemaining },
    }],
  };
}
