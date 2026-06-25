import type { WorkflowState } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.self_healing');

const PROMOTE_THRESHOLD = 3;   // violations in last 20 sessions → promote to critic check
const LOOKBACK_SESSIONS  = 20;

export async function updateSelfHealingRules(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<void> {
  // Record violations from this session
  const violations = state.criticFindings.filter(f => f.severity === 'critical');
  for (const v of violations) {
    try {
      await deps.memory.add(
        `Rule violated: ${v.ruleId} in ${v.file} — ${v.message}`,
        'global', 'tacv-violations',
        { type: 'rule_violation', ruleId: v.ruleId, critic: v.critic, moduleType: state.task.moduleType, sessionId: state.sessionId },
      );
    } catch { /* non-critical */ }
  }

  // Count recent violations per rule
  let recentViolations: Array<{ metadata: Record<string, unknown> }> = [];
  try {
    recentViolations = await deps.memory.search({
      userId:  'global',
      agentId: 'tacv-violations',
      text:    `rule violation ${state.task.moduleType}`,
      topK:    LOOKBACK_SESSIONS * 5,
      filters: { type: 'rule_violation', moduleType: state.task.moduleType },
    });
  } catch { return; }

  const counts = new Map<string, number>();
  for (const v of recentViolations) {
    const ruleId = v.metadata['ruleId'] as string;
    if (ruleId) counts.set(ruleId, (counts.get(ruleId) ?? 0) + 1);
  }

  for (const [ruleId, count] of counts) {
    if (count >= PROMOTE_THRESHOLD) {
      log.info('self_healing.rule_promoted', { ruleId, count, moduleType: state.task.moduleType });
      // Persist promotion so the Actor system prompt can be updated
      try {
        await deps.memory.add(
          `PROMOTED RULE: ${ruleId} — violated ${count} times. Add as enforced check for ${state.task.moduleType}.`,
          'global', 'tacv-agent',
          { type: 'procedural', subtype: 'promoted_rule', ruleId, moduleType: state.task.moduleType, violationCount: count },
        );
      } catch { /* non-critical */ }
    }
  }
}
