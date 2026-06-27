import { z } from 'zod';
import type { WorkflowState } from '../../state/schemas.js';
import { LessonLearned } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const log = createLogger('tacv.memory_consolidation');

const LessonOutput = z.object({
  outcomeSummary:  z.string(),
  keyDecisions:    z.array(z.string()),
  commonMistakes:  z.array(z.string()),
  archDecisions:   z.array(z.string()),
  testsAdded:      z.array(z.string()),
  succeededVia:    z.enum(['direct','debugger','speculative','hitl']),
});

// ── Lesson quality gate ───────────────────────────────────────────────────────
const LessonQualityReview = z.object({
  safe:     z.boolean(),
  concerns: z.array(z.string()),
});

async function auditLessonQuality(lesson: LessonLearned, deps: ActivityDeps): Promise<string[]> {
  try {
    const review = await deps.extractor.extract(
      `Audit this lesson-learned document for quality before persisting to long-term memory.

Lesson:
${JSON.stringify(lesson, null, 2)}

Red flags to check:
1. Does the outcome summary mention "simplified tests", "removed assertions", "disabled tests", or "skipped tests"?
2. Does it describe deleting, disabling, or weakening any test?
3. Does "succeededVia" not match the correctionAttempts (e.g., 0 attempts but not "direct")?
4. Does it contain patterns that contradict good TDD practice?
5. Are keyDecisions suspiciously vague or empty for a complex task?

Return safe=true only if none of these red flags are present.`,
      LessonQualityReview,
      { system: 'You audit lesson quality to prevent bad patterns from propagating to future sessions.', model: 'claude-haiku-4-5-20251001' },
    );
    return review.safe ? [] : (review.concerns ?? []);
  } catch { return []; }
}

export async function memoryConsolidationImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  log.info('memory_consolidation.start', { taskId: state.taskId });

  const output = await deps.extractor.extract(
    `Summarise this completed development session:\nTask: ${state.task.description}\nAttempts: ${state.correctionCycle.attemptCount}\nCost: $${state.cumulativeCostUsd.toFixed(4)}\nAudit: ${JSON.stringify(state.workflowAuditTrail.slice(-20))}`,
    LessonOutput,
    { system: 'You are a tech lead writing a concise lesson-learned document for future reference.' },
  );

  const lesson: LessonLearned = {
    taskId: state.taskId, sessionId: state.sessionId,
    taskDescription: state.task.description,
    correctionAttempts: state.correctionCycle.attemptCount,
    totalCostUsd:       state.cumulativeCostUsd,
    testsAdded:         state.diffProposal?.testFilePaths ?? [],
    qualityFlags:       [],
    ...output,
  };

  // ── Quality gate: audit before persisting ─────────────────────────────────
  const qualityIssues = await auditLessonQuality(lesson, deps);
  if (qualityIssues.length > 0) {
    log.warn('memory_consolidation.lesson_flagged', { issues: qualityIssues });
    lesson.qualityFlags = qualityIssues;
    lesson.outcomeSummary = `⚠️ FLAGGED FOR REVIEW: ${qualityIssues.join('; ')}\n\n${lesson.outcomeSummary}`;
  }

  // Persist lesson
  try {
    await deps.memory.add(
      JSON.stringify({ ...lesson, subtype: 'lesson_learned' }),
      lesson.taskId, 'tacv-agent',
      { type: 'episodic', subtype: 'lesson_learned', sessionId: lesson.sessionId, qualityFlagged: qualityIssues.length > 0 },
    );
    log.info('memory_consolidation.lesson_persisted', { flagged: qualityIssues.length > 0 });
  } catch (err) { log.warn('memory_consolidation.persist_failed', { error: String(err) }); }

  // Purge session noise (sleep-cycle consolidation)
  try {
    const all = await deps.memory.getAll(state.taskId, 'tacv-agent');
    const noise = all.filter(m => m.metadata['type'] === 'episodic' && m.metadata['subtype'] !== 'lesson_learned');
    await Promise.all(noise.map(m => deps.memory.delete(m.id)));
    log.info('memory_consolidation.session_purged', { purgedCount: noise.length });
  } catch (err) { log.warn('memory_consolidation.purge_failed', { error: String(err) }); }

  // Update AGENTS.md
  if (lesson.keyDecisions.length > 0 || lesson.commonMistakes.length > 0) {
    try {
      const agentsMdPath = path.join(deps.repoPath, 'AGENTS.md');
      const existing = await fs.readFile(agentsMdPath, 'utf8').catch(() => '# AGENTS.md\n');
      const addition = `\n## Session ${new Date().toISOString().slice(0,10)} — ${lesson.taskDescription.slice(0,60)}\n` +
        (lesson.keyDecisions.length > 0 ? `### Key Decisions\n${lesson.keyDecisions.map(d=>`- ${d}`).join('\n')}\n` : '') +
        (lesson.commonMistakes.length > 0 ? `### Avoid These Mistakes\n${lesson.commonMistakes.map(m=>`- ${m}`).join('\n')}\n` : '');
      await fs.writeFile(agentsMdPath, existing + addition);
      log.info('memory_consolidation.agents_md_updated');
    } catch (err) { log.warn('memory_consolidation.agents_md_failed', { error: String(err) }); }
  }

  // Self-healing AGENTS.md
  try {
    const { updateSelfHealingRules } = await import('./selfHealingAgentsMd.js');
    await updateSelfHealingRules(state, deps);
  } catch (err) { log.warn('memory_consolidation.self_healing_failed', { error: String(err) }); }

  return {
    ...state,
    currentPhase:  'COMPLETE',
    lessonLearned: lesson,
    workflowAuditTrail: [...state.workflowAuditTrail, {
      timestampMs: Date.now(), node: 'memory_consolidation',
      decision:    'lesson_compiled',
      keyValues:   { succeededVia: lesson.succeededVia, costUsd: lesson.totalCostUsd, qualityFlagged: qualityIssues.length > 0 },
    }],
  };
}
