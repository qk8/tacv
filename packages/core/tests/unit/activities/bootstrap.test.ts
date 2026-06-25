import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrapImpl } from '../../../src/activities/bootstrap/impl.js';
import { createInitialState } from '../../../src/state/schemas.js';
import { makeStubDeps } from '../../helpers/stubDeps.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

const task = { taskId: 'b1', description: 'test', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('bootstrapImpl', () => {
  beforeEach(() => vi.resetAllMocks());

  it('transitions to SCOUT phase', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    const state = createInitialState(task);
    const result = await bootstrapImpl(state, makeStubDeps());
    expect(result.currentPhase).toBe('SCOUT');
  });

  it('loads AGENTS.md when present', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('# Conventions\n- Use TypeScript strict mode' as never);
    const state = createInitialState(task);
    const result = await bootstrapImpl(state, makeStubDeps());
    expect(result.agentsMdContext).toContain('Conventions');
  });

  it('handles missing AGENTS.md gracefully', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    const state = createInitialState(task);
    const result = await bootstrapImpl(state, makeStubDeps());
    expect(result.agentsMdContext).toBeNull();
  });

  it('adds session_started audit entry', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    const state = createInitialState(task);
    const result = await bootstrapImpl(state, makeStubDeps());
    expect(result.workflowAuditTrail.some(e => e.decision === 'session_started')).toBe(true);
  });

  it('truncates AGENTS.md to max chars', async () => {
    const longContent = 'x'.repeat(10_000);
    vi.mocked(fs.readFile).mockResolvedValue(longContent as never);
    const deps = makeStubDeps();
    deps.config.agentsMdMaxChars = 1000;
    const state = createInitialState(task);
    const result = await bootstrapImpl(state, deps);
    expect((result.agentsMdContext ?? '').length).toBeLessThanOrEqual(1000);
  });
});
