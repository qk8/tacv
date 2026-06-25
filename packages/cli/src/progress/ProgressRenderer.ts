import type { WorkflowHandle } from '@temporalio/client';
import type { WorkflowState }  from '@tacv/core/state';
import { createLogger }        from '@tacv/core/observability';

const log = createLogger('tacv.cli.progress');

const EMOJI: Record<string, string> = {
  BOOTSTRAP:'🚀',SCOUT:'🔍',VALUE_NODE:'📊',TDD_GATE:'🧪',ACTOR:'✍️',
  PREFLIGHT:'✈️',CRITICS:'👁️',VERIFIER:'✅',INTELLIGENT_DEBUGGER:'🐛',
  REPLAN:'🔄',SPECULATIVE_BRANCH:'🌿',HITL_ESCALATION:'🙋',
  MEMORY_CONSOLIDATION:'💾',COMPLETE:'🎉',FAILED:'❌',
};

export class ProgressRenderer {
  async render(handle: WorkflowHandle): Promise<void> {
    let lastPhase   = '';
    let lastAttempt = -1;

    const interval = setInterval(async () => {
      try {
        const state = await handle.query('workflow.state') as WorkflowState;
        if (state.currentPhase !== lastPhase || state.correctionCycle.attemptCount !== lastAttempt) {
          lastPhase   = state.currentPhase;
          lastAttempt = state.correctionCycle.attemptCount;

          log.info('workflow.progress', { phase: state.currentPhase, attempt: state.correctionCycle.attemptCount, costUsd: state.cumulativeCostUsd.toFixed(4), confidence: state.confidenceScore.toFixed(3) });

          const emoji = EMOJI[state.currentPhase] ?? '⚙️';
          process.stderr.write(`\r${emoji} ${state.currentPhase.padEnd(25)} attempt=${lastAttempt} $${state.cumulativeCostUsd.toFixed(4)} conf=${state.confidenceScore.toFixed(2)}  `);
        }
      } catch { /* workflow may have just completed */ }
    }, 1000);

    try { await handle.result(); }
    finally { clearInterval(interval); process.stderr.write('\n'); }
  }
}
