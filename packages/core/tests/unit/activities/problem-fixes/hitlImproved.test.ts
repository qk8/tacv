import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hitlImpl } from '../../../../src/activities/hitl/impl.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

const task = { taskId: 'h1', description: 'Add auth', mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['java'] };

function makeState(overrides: Record<string, unknown> = {}) {
  return { ...createInitialState(task), workflowStartMs: Date.now(), ...overrides };
}

describe('hitlImpl (improved)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as never);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it('transitions to HITL_ESCALATION', async () => {
    const result = await hitlImpl(makeState() as never, 'max_cycles_reached', makeStubDeps());
    expect(result.currentPhase).toBe('HITL_ESCALATION');
  });

  it('records hitlBudgetAtEscalation from cumulativeCostUsd', async () => {
    const state = makeState({ cumulativeCostUsd: 42.5 });
    const result = await hitlImpl(state as never, 'budget_exceeded', makeStubDeps());
    expect(result.hitlBudgetAtEscalation).toBe(42.5);
  });

  it('includes staleness warning when session is old', async () => {
    const state = makeState({ workflowStartMs: Date.now() - 9 * 3_600_000 }); // 9 hours ago
    const result = await hitlImpl(state as never, 'low_confidence', makeStubDeps());
    const payload = result.escalationPayload as Record<string, unknown>;
    expect(payload?.['stalenessWarning']).toContain('STALENESS RISK');
  });

  it('no staleness warning for fresh sessions', async () => {
    const state = makeState({ workflowStartMs: Date.now() - 2 * 3_600_000 }); // 2 hours ago
    const result = await hitlImpl(state as never, 'stagnation', makeStubDeps());
    const payload = result.escalationPayload as Record<string, unknown>;
    expect(payload?.['stalenessWarning']).toBeNull();
  });

  it('includes budget warning when budget nearly exhausted', async () => {
    const state = makeState({ cumulativeCostUsd: 72 }); // 90% of $80
    const result = await hitlImpl(state as never, 'max_cycles_reached', makeStubDeps());
    const payload = result.escalationPayload as Record<string, unknown>;
    expect(payload?.['budgetWarning']).toContain('LOW BUDGET');
  });

  it('includes test fault info when flag is set', async () => {
    const state = makeState({
      testValidityFlag: { suspected: true, affectedTests: ['findById test'], proposedFixes: [{ testFile: 'UserService.test.ts', currentAssertion: 'toBeNull()', suggestedFix: 'toMatchObject({id:1})', justification: 'Inverted assertion' }], confidence: 0.9, detectedAtCycle: 2 },
    });
    const result = await hitlImpl(state as never, 'suspected_test_fault', makeStubDeps());
    const payload = result.escalationPayload as Record<string, unknown>;
    expect((payload?.['testFaultInfo'] as Record<string, unknown>)?.['testFaultSuspected']).toBe(true);
  });

  it('includes prior guidance from previous HITL in same session', async () => {
    const state = makeState({ hitlPriorGuidance: 'Use constructor injection not field injection' });
    const result = await hitlImpl(state as never, 'max_cycles_reached', makeStubDeps());
    const payload = result.escalationPayload as Record<string, unknown>;
    expect(payload?.['priorGuidance']).toBe('Use constructor injection not field injection');
  });

  it('includes resume instructions in payload', async () => {
    const result = await hitlImpl(makeState() as never, 'stagnation', makeStubDeps());
    const payload = result.escalationPayload as Record<string, unknown>;
    const instructions = payload?.['resumeInstructions'] as string[];
    expect(instructions.some(i => i.includes('--action override'))).toBe(true);
    expect(instructions.some(i => i.includes('--action reject'))).toBe(true);
  });

  it('handles disk write failure gracefully — still returns HITL state', async () => {
    vi.mocked(fs.mkdir).mockRejectedValue(new Error('Permission denied'));
    const result = await hitlImpl(makeState() as never, 'budget_exceeded', makeStubDeps());
    expect(result.currentPhase).toBe('HITL_ESCALATION');  // still escalates
  });
});
