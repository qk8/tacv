import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { isBackendModule } from './shared.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.critics.performance');

interface BenchmarkBaseline {
  benchmarks: Array<{ name: string; file: string; opsPerSec: number }>;
  recordedAt: string;
}

export async function performanceCritic(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<CriticFinding[]> {
  if (!state.diffProposal) return [];
  if (!deps.config.performance.enabled) return [];
  if (!isBackendModule(state.task.moduleType)) return [];

  const langId  = state.task.languageIds[0] ?? 'typescript';
  const plugin  = deps.pluginRegistry.get(langId);
  const changed = state.diffProposal.diffs.map(d => d.filePath);

  let current: { benchmarks: Array<{ name: string; file: string; opsPerSec: number }> };
  try {
    current = await plugin.runBenchmarks(deps.repoPath, changed);
  } catch (err) {
    log.warn('performance_critic.benchmark_failed', { error: String(err) });
    return [];
  }

  if (current.benchmarks.length === 0) return [];

  // Load baseline from memory
  let baseline: BenchmarkBaseline | null = null;
  try {
    const memories = await deps.memory.search({
      userId: 'global', agentId: 'tacv-benchmarks',
      text: `benchmark baseline ${state.task.moduleType}`,
      topK: 1,
      filters: { type: 'benchmark_baseline', moduleType: state.task.moduleType },
    });
    if (memories.length > 0 && memories[0]) {
      baseline = JSON.parse(memories[0].text) as BenchmarkBaseline;
    }
  } catch { /* no baseline yet */ }

  // First run — store baseline, no findings
  if (!baseline) {
    try {
      await deps.memory.add(
        JSON.stringify({ ...current, recordedAt: new Date().toISOString() }),
        'global', 'tacv-benchmarks',
        { type: 'benchmark_baseline', moduleType: state.task.moduleType },
      );
      log.info('performance_critic.baseline_recorded', { benchmarks: current.benchmarks.length });
    } catch (err) {
      log.warn('performance_critic.baseline_store_failed', { error: String(err) });
    }
    return [];
  }

  const threshold = deps.config.performance.regressionThreshold;
  const findings: CriticFinding[] = [];

  for (const b of baseline.benchmarks) {
    const curr = current.benchmarks.find(c => c.name === b.name);
    if (!curr) continue;
    const regFraction = (b.opsPerSec - curr.opsPerSec) / b.opsPerSec;
    if (regFraction >= threshold) {
      const regPct = Math.round(regFraction * 100);
      findings.push({
        critic:         'performance',
        severity:       regPct > 40 ? 'critical' : 'warning',
        file:           b.file,
        line:           null,
        ruleId:         'PERF_REGRESSION',
        message:        `${b.name}: ${regPct}% performance regression (${b.opsPerSec.toFixed(0)} → ${curr.opsPerSec.toFixed(0)} ops/sec)`,
        resolutionHint: 'Profile for N+1 queries, missing indexes, or blocking I/O. Run with: --prof or async-profiler.',
      });
    }
  }

  if (findings.length > 0) {
    log.warn('performance_critic.regressions_found', { count: findings.length });
  }
  return findings;
}
