import { describe, it, expect, vi } from 'vitest';
import { requirementTraceCritic } from '../../../../src/activities/critics/requirementTraceCritic.js';
import { createInitialState } from '../../../../src/state/schemas.js';
import { makeStubDeps } from '../../../helpers/stubDeps.js';

const task = { taskId: 'rt1', description: 'Implement rate limiting: 100 requests per minute per user (not per IP)', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

describe('requirementTraceCritic', () => {
  it('returns empty when no diffProposal', async () => {
    expect(await requirementTraceCritic(createInitialState(task) as never, makeStubDeps())).toHaveLength(0);
  });

  it('returns empty when no production code changes', async () => {
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/rate.test.ts', operation: 'modify' as const, diffContent: '+ it("test", () => {})', language: 'ts' }], summary: '', testFilePaths: [] } };
    expect(await requirementTraceCritic(state as never, makeStubDeps())).toHaveLength(0);
  });

  it('flags requirement not met (rate limit per IP instead of per user)', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: vi.fn().mockResolvedValue([{ requirement: 'Rate limiting per user (not per IP)', implemented: false, discrepancy: 'Implementation limits per IP address but task specifies per user' }]) };
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/RateLimiter.ts', operation: 'create' as const, diffContent: '+  const key = req.ip; // rate limit by IP', language: 'ts' }], summary: '', testFilePaths: [] } };
    const findings = await requirementTraceCritic(state as never, deps);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('REQUIREMENT_NOT_MET');
    expect(findings[0]?.critic).toBe('requirement_trace');
    expect(findings[0]?.severity).toBe('critical');
  });

  it('returns empty when all requirements are met', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: vi.fn().mockResolvedValue([{ requirement: 'Rate limiting per user', implemented: true, discrepancy: null }]) };
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/RateLimiter.ts', operation: 'create' as const, diffContent: '+  const key = `user:${req.userId}`;', language: 'ts' }], summary: '', testFilePaths: [] } };
    expect(await requirementTraceCritic(state as never, deps)).toHaveLength(0);
  });

  it('handles extractor failure gracefully', async () => {
    const deps = makeStubDeps();
    deps.extractor = { extract: vi.fn().mockRejectedValue(new Error('timeout')) };
    const state = { ...createInitialState(task), diffProposal: { diffs: [{ filePath: 'src/a.ts', operation: 'modify' as const, diffContent: '+ const x = 1;', language: 'ts' }], summary: '', testFilePaths: [] } };
    expect(await requirementTraceCritic(state as never, deps)).toHaveLength(0);
  });
});
