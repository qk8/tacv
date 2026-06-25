import { describe, it, expect, vi } from 'vitest';
import { updateSelfHealingRules } from '../../../src/activities/memory/selfHealingAgentsMd.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';

const task = { taskId: 'sh1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('updateSelfHealingRules', () => {
  it('records critical violations in memory', async () => {
    const addSpy = vi.fn().mockResolvedValue('id1');
    const deps = makeStubDeps();
    deps.memory = { ...deps.memory, add: addSpy, search: vi.fn().mockResolvedValue([]) };
    const state = { ...createInitialState(task), criticFindings: [{ critic: 'security' as const, severity: 'critical' as const, file: 'src/api.ts', line: 5, ruleId: 'NO_EVAL', message: 'eval usage', resolutionHint: 'fix' }] };
    await updateSelfHealingRules(state as never, deps);
    expect(addSpy).toHaveBeenCalledWith(expect.stringContaining('NO_EVAL'), 'global', 'tacv-violations', expect.objectContaining({ ruleId: 'NO_EVAL' }));
  });

  it('handles memory search failure gracefully', async () => {
    const deps = makeStubDeps();
    deps.memory = { ...deps.memory, add: vi.fn().mockResolvedValue('id1'), search: vi.fn().mockRejectedValue(new Error('down')) };
    await expect(updateSelfHealingRules(createInitialState(task) as never, deps)).resolves.not.toThrow();
  });

  it('promotes rule after 3 violations', async () => {
    const addSpy = vi.fn().mockResolvedValue('id1');
    const mockViolations = Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, text: `Rule violated: NO_EVAL`, metadata: { type: 'rule_violation', ruleId: 'NO_EVAL', moduleType: 'backend' } }));
    const deps = makeStubDeps();
    deps.memory = { ...deps.memory, add: addSpy, search: vi.fn().mockResolvedValue(mockViolations) };
    await updateSelfHealingRules(createInitialState(task) as never, deps);
    const promotedCall = addSpy.mock.calls.find((c: unknown[]) => String(c[0]).includes('PROMOTED RULE'));
    expect(promotedCall).toBeDefined();
  });
});
