import { describe, it, expect, vi } from 'vitest';
import { feasibilityCheckImpl } from '../../../../src/activities/feasibility/impl.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'f1', description: 'Add user auth', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['java'] };

describe('feasibilityCheckImpl', () => {
  it('skips when feasibility.enabled is false', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, feasibility: { ...deps.config.feasibility, enabled: false } };
    const result = await feasibilityCheckImpl(createInitialState(task), deps);
    expect(result.currentPhase).toBe('VALUE_NODE');
    expect(result.feasibility).toBeNull();
  });

  it('transitions to VALUE_NODE when ambiguity is low', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, feasibility: { enabled: true, ambiguityThreshold: 4, complexityThreshold: 5, model: 'claude-haiku-4-5-20251001' } };
    deps.extractor = { extract: vi.fn().mockResolvedValue({ ambiguity: 1, complexity: 2, risk: 1, ambiguities: [], shouldEscalateEarly: false, escalationReason: null }) };
    const result = await feasibilityCheckImpl(createInitialState(task), deps);
    expect(result.currentPhase).toBe('VALUE_NODE');
    expect(result.feasibility?.ambiguity).toBe(1);
  });

  it('escalates to HITL when ambiguity is high', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, feasibility: { enabled: true, ambiguityThreshold: 4, complexityThreshold: 5, model: 'claude-haiku-4-5-20251001' } };
    deps.extractor = { extract: vi.fn().mockResolvedValue({ ambiguity: 5, complexity: 4, risk: 3, ambiguities: ['What token format?', 'Which endpoints need auth?'], shouldEscalateEarly: true, escalationReason: 'Ambiguity score 5/5 — many unstated assumptions' }) };
    const result = await feasibilityCheckImpl(createInitialState(task), deps);
    expect(result.currentPhase).toBe('HITL_ESCALATION');
    expect((result.escalationPayload as Record<string, unknown>)?.['reason']).toBe('high_ambiguity_before_start');
    expect((result.escalationPayload as Record<string, unknown>)?.['ambiguities']).toHaveLength(2);
  });

  it('handles extractor failure gracefully', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, feasibility: { enabled: true, ambiguityThreshold: 4, complexityThreshold: 5, model: 'claude-haiku-4-5-20251001' } };
    deps.extractor = { extract: vi.fn().mockRejectedValue(new Error('LLM unavailable')) };
    const result = await feasibilityCheckImpl(createInitialState(task), deps);
    expect(result.currentPhase).toBe('VALUE_NODE');  // graceful fallback
    expect(result.feasibility).toBeNull();
  });

  it('stores feasibility in state for audit trail', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, feasibility: { enabled: true, ambiguityThreshold: 4, complexityThreshold: 5, model: 'claude-haiku-4-5-20251001' } };
    deps.extractor = { extract: vi.fn().mockResolvedValue({ ambiguity: 2, complexity: 3, risk: 2, ambiguities: [], shouldEscalateEarly: false, escalationReason: null }) };
    const result = await feasibilityCheckImpl(createInitialState(task), deps);
    expect(result.feasibility?.complexity).toBe(3);
  });
});
