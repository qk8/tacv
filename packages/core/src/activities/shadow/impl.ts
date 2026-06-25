import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.shadow');

export interface ShadowTaskCtx {
  taskId: string;
  taskDescription: string;
  repoPath: string;
  moduleType: string;
  languageIds: string[];
}

export interface ShadowFinding {
  description: string;
  file: string;
  severity: 'low' | 'medium' | 'high';
  source: 'refactor' | 'fuzz';
}

export async function pickRecentTaskForFuzz(
  opts: { repoPath: string; count: number },
  deps: ActivityDeps,
): Promise<ShadowTaskCtx[]> {
  try {
    const memories = await deps.memory.search({
      userId: 'global', agentId: 'tacv-agent',
      text: 'lesson_learned completed task',
      topK: opts.count,
      filters: { type: 'episodic', subtype: 'lesson_learned' },
    });
    return memories
      .map(m => { try { return JSON.parse(m.text) as ShadowTaskCtx; } catch { return null; } })
      .filter((t): t is ShadowTaskCtx => t !== null && Boolean(t.taskId));
  } catch (err) {
    log.warn('shadow.pick_tasks_failed', { error: String(err) });
    return [];
  }
}

export async function runMicroRefactoring(
  task: ShadowTaskCtx,
  deps: ActivityDeps,
): Promise<ShadowFinding[]> {
  log.info('shadow.micro_refactoring', { taskId: task.taskId });
  try {
    const result = await deps.agent.runTask(
      `You are a code quality analyst in autonomous mode. Review this codebase area for safe micro-refactoring opportunities.
Task context: ${task.taskDescription}
Module: ${task.moduleType}
Languages: ${task.languageIds.join(', ')}
Repository: ${task.repoPath}

Identify ONLY safe, non-breaking improvements (unused imports, duplicate logic, long functions, missing null checks).
Return a JSON array: [{"description":"...","file":"...","severity":"low|medium|high"}]
Return empty array [] if nothing found.`,
      { repoPath: task.repoPath },
      { role: 'shadow_refactor_analyst', systemPrompt: 'You find safe, non-breaking refactoring opportunities. Return only JSON.', maxTurns: 1, allowedTools: [] },
      0,
    );
    const match = result.content.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as Array<{ description: string; file: string; severity: string }>;
    return parsed.map(f => ({ ...f, severity: (f.severity as 'low' | 'medium' | 'high') ?? 'low', source: 'refactor' as const }));
  } catch (err) {
    log.warn('shadow.refactor_failed', { taskId: task.taskId, error: String(err) });
    return [];
  }
}

export async function fuzzEdgeCases(
  task: ShadowTaskCtx,
  deps: ActivityDeps,
): Promise<ShadowFinding[]> {
  log.info('shadow.fuzz_edge_cases', { taskId: task.taskId });
  const findings: ShadowFinding[] = [];

  if (task.languageIds.length === 0) return findings;

  try {
    const plugin = deps.pluginRegistry.get(task.languageIds[0]!);
    const testResult = await plugin.runProtectionTests(task.repoPath, { timeout: 60_000 });

    if (!testResult.passed) {
      findings.push(...testResult.failures.map(f => ({
        description: `Shadow mode discovered edge case: ${f.message}`,
        file: f.file ?? 'unknown',
        severity: 'medium' as const,
        source: 'fuzz' as const,
      })));
    }
  } catch (err) {
    log.warn('shadow.fuzz_failed', { taskId: task.taskId, error: String(err) });
  }
  return findings;
}

export async function persistShadowFindings(
  taskId: string,
  findings: ShadowFinding[],
  deps: ActivityDeps,
): Promise<void> {
  if (findings.length === 0) return;
  for (const finding of findings) {
    await deps.memory.add(
      `Shadow mode finding: ${finding.description}`,
      'global', 'tacv-shadow',
      { type: 'procedural', subtype: 'shadow_finding', file: finding.file, severity: finding.severity, source: finding.source, taskId },
    );
  }
  log.info('shadow.findings_persisted', { taskId, count: findings.length });
}

export async function runShadowCycleImpl(
  ctx: { repoPath: string; maxTasks: number },
  deps: ActivityDeps,
): Promise<void> {
  log.info('shadow.cycle_start', { maxTasks: ctx.maxTasks });

  const tasks = await pickRecentTaskForFuzz({ repoPath: ctx.repoPath, count: ctx.maxTasks }, deps);
  log.info('shadow.tasks_selected', { count: tasks.length });

  for (const task of tasks) {
    try {
      const [refactorFindings, fuzzFindings] = await Promise.all([
        runMicroRefactoring(task, deps),
        fuzzEdgeCases(task, deps),
      ]);
      const allFindings = [...refactorFindings, ...fuzzFindings];
      await persistShadowFindings(task.taskId, allFindings, deps);
      log.info('shadow.task_complete', { taskId: task.taskId, findings: allFindings.length });
    } catch (err) {
      log.warn('shadow.task_failed', { taskId: task.taskId, error: String(err) });
    }
  }
  log.info('shadow.cycle_complete');
}
