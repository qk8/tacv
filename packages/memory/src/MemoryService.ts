import type { IMemoryProvider, MemoryItem } from '@tacv/core/interfaces';

export interface SessionContext {
  taskId:     string;
  sessionId:  string;
  taskDescription: string;
  moduleType: string;
  languageIds: string[];
  mode:       string;
}

export class MemoryService {
  constructor(private readonly provider: IMemoryProvider) {}

  async recordSessionStart(ctx: SessionContext): Promise<void> {
    await this.provider.add(
      `Task started: ${ctx.taskDescription}`,
      ctx.taskId, 'tacv-agent',
      { type: 'episodic', phase: 'session_start', mode: ctx.mode },
    );
  }

  async recordAttemptOutcome(ctx: SessionContext, attempt: number, verdict: string, diagnostic: string): Promise<void> {
    await this.provider.add(
      `Attempt ${attempt}: verdict=${verdict} diagnostic=${diagnostic}`,
      ctx.taskId, 'tacv-agent',
      { type: 'episodic', phase: 'attempt_outcome', attempt, verdict, diagnostic },
    );
  }

  async recordHumanCorrection(ctx: SessionContext, guidance: string): Promise<void> {
    await this.provider.add(
      `HUMAN CORRECTION for '${ctx.moduleType}': ${guidance}`,
      'global', 'tacv-agent',
      { type: 'procedural', subtype: 'human_correction', moduleType: ctx.moduleType, languageIds: ctx.languageIds, mode: ctx.mode, sessionId: ctx.sessionId },
    );
  }

  async persistLesson(lesson: Record<string, unknown>): Promise<void> {
    await this.provider.add(
      JSON.stringify({ ...lesson, subtype: 'lesson_learned' }),
      'global', 'tacv-agent',
      { type: 'episodic', subtype: 'lesson_learned', sessionId: lesson['sessionId'] },
    );
  }

  async purgeSessionNoise(taskId: string): Promise<void> {
    const all = await this.provider.getAll(taskId, 'tacv-agent');
    const noise = all.filter(m => m.metadata['type'] === 'episodic' && m.metadata['subtype'] !== 'lesson_learned');
    await Promise.all(noise.map(m => this.provider.delete(m.id)));
  }

  async getRelevantContext(taskDescription: string, moduleType: string): Promise<string> {
    const [lessons, corrections] = await Promise.all([
      this.provider.search({ userId: 'global', agentId: 'tacv-agent', text: taskDescription, topK: 5, filters: { type: 'episodic', subtype: 'lesson_learned' } }),
      this.provider.search({ userId: 'global', agentId: 'tacv-agent', text: `corrections for ${moduleType}`, topK: 5, filters: { type: 'procedural', subtype: 'human_correction' } }),
    ]);
    const parts: string[] = [];
    if (lessons.length > 0) parts.push('## Prior lessons:\n' + lessons.map(l => `- ${l.text.slice(0, 200)}`).join('\n'));
    if (corrections.length > 0) parts.push('## Human corrections:\n' + corrections.map(c => `- ${c.text.slice(0, 300)}`).join('\n'));
    return parts.join('\n\n');
  }

  async persistShadowFindings(taskId: string, findings: Array<{ description: string; file: string; severity: string }>): Promise<void> {
    for (const f of findings) {
      await this.provider.add(`Shadow mode finding: ${f.description}`, 'global', 'tacv-shadow', { type: 'procedural', subtype: 'shadow_finding', file: f.file, severity: f.severity, taskId });
    }
  }
}
