import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryService } from '../src/MemoryService.js';
import { InMemoryProvider } from '../src/providers/InMemoryProvider.js';

const ctx = { taskId: 'task-1', sessionId: 'sess-1', taskDescription: 'Add JWT authentication', moduleType: 'java-backend', languageIds: ['java'], mode: 'GREENFIELD' };

describe('MemoryService', () => {
  let provider: InMemoryProvider;
  let service:  MemoryService;

  beforeEach(() => {
    provider = new InMemoryProvider();
    service  = new MemoryService(provider);
  });

  it('records session start', async () => {
    await service.recordSessionStart(ctx);
    const items = await provider.getAll(ctx.taskId, 'tacv-agent');
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain('Task started');
    expect(items[0]?.metadata['type']).toBe('episodic');
  });

  it('records attempt outcome', async () => {
    await service.recordAttemptOutcome(ctx, 2, 'FAIL', 'FIX_IMPL');
    const items = await provider.getAll(ctx.taskId, 'tacv-agent');
    expect(items[0]?.text).toContain('Attempt 2');
    expect(items[0]?.metadata['verdict']).toBe('FAIL');
  });

  it('records human correction with global scope', async () => {
    await service.recordHumanCorrection(ctx, 'Always use RS256 for JWT signing');
    const items = await provider.getAll('global', 'tacv-agent');
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain('RS256');
    expect(items[0]?.metadata['subtype']).toBe('human_correction');
  });

  it('persists lesson with lesson_learned subtype', async () => {
    await service.persistLesson({ taskId: ctx.taskId, sessionId: ctx.sessionId, outcomeSummary: 'Added JWT', keyDecisions: ['Used RS256'] });
    const items = await provider.getAll(ctx.taskId, 'tacv-agent');
    expect(items.some(i => i.metadata['subtype'] === 'lesson_learned')).toBe(true);
  });

  it('purges session noise, keeps lessons', async () => {
    await service.recordAttemptOutcome(ctx, 1, 'FAIL', 'FIX_IMPL');
    await service.persistLesson({ taskId: ctx.taskId, sessionId: ctx.sessionId, outcomeSummary: 'Done' });
    await service.purgeSessionNoise(ctx.taskId);
    const remaining = await provider.getAll(ctx.taskId, 'tacv-agent');
    expect(remaining.every(i => i.metadata['subtype'] === 'lesson_learned')).toBe(true);
  });

  it('getRelevantContext returns combined context', async () => {
    await service.persistLesson({ taskId: ctx.taskId, sessionId: ctx.sessionId, outcomeSummary: 'JWT lesson for Spring Boot' });
    await service.recordHumanCorrection(ctx, 'Use RS256 for java-backend');
    const context = await service.getRelevantContext('Add JWT auth', 'java-backend');
    expect(context).toContain('Prior lessons');
  });

  it('persistShadowFindings stores in global scope', async () => {
    await service.persistShadowFindings('task-1', [{ description: 'N+1 query found', file: 'UserRepo.java', severity: 'medium' }]);
    const items = await provider.getAll('global', 'tacv-shadow');
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain('N+1');
  });
});
