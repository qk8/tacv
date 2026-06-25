import { describe, it, expect, vi } from 'vitest';
import { sandboxValidationImpl } from '../../../../src/activities/sandbox-validation/impl.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'sv1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['java'] };

describe('sandboxValidationImpl', () => {
  it('skips when no sandboxEnvExpected configured', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, sandboxEnvExpected: undefined };
    const result = await sandboxValidationImpl(createInitialState(task), deps);
    expect(result.sandboxEnvOk).toBe(true);
    expect(result.currentPhase).toBe('ACTOR');
  });

  it('marks ok when environment matches expected', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, sandboxEnvExpected: { javaVersion: '21', timezone: 'UTC' } };
    deps.sandbox = { ...deps.sandbox, execInContainer: vi.fn().mockResolvedValue({ stdout: 'openjdk version "21.0.3"\nTZ=UTC\nUTC', stderr: '', exitCode: 0 }) };
    const result = await sandboxValidationImpl(createInitialState(task), deps);
    expect(result.sandboxEnvOk).toBe(true);
  });

  it('marks ok=false with audit entry on version mismatch', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, sandboxEnvExpected: { javaVersion: '21' } };
    deps.sandbox = { ...deps.sandbox, execInContainer: vi.fn().mockResolvedValue({ stdout: 'openjdk version "17.0.1"\nTZ=UTC', stderr: '', exitCode: 0 }) };
    const result = await sandboxValidationImpl(createInitialState(task), deps);
    expect(result.sandboxEnvOk).toBe(false);
    expect(result.currentPhase).toBe('ACTOR');  // drift is a warning, not a blocker
    expect(result.workflowAuditTrail.some(e => e.decision === 'env_drift_detected')).toBe(true);
  });

  it('handles sandbox exec failure gracefully', async () => {
    const deps = makeStubDeps();
    deps.config = { ...deps.config, sandboxEnvExpected: { javaVersion: '21' } };
    deps.sandbox = { ...deps.sandbox, warmContainer: vi.fn().mockRejectedValue(new Error('Docker not available')) };
    const result = await sandboxValidationImpl(createInitialState(task), deps);
    expect(result.sandboxEnvOk).toBeNull();
    expect(result.currentPhase).toBe('ACTOR');
  });
});
