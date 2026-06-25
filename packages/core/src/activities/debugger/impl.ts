import type { WorkflowState } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.debugger.activity');

export async function debuggerImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  const verdict = state.verifierVerdict;
  if (!verdict || verdict.testResult === 'PASS') return state;

  log.info('debugger_activity.start', { taskId: state.taskId, errorCount: verdict.testFailures.length });

  try {
    // Use the full IntelligentDebugger from @tacv/debugger if available
    const { IntelligentDebugger } = await import('@tacv/debugger');
    const langId = state.task.languageIds[0] ?? 'typescript';

    const debugger_ = new IntelligentDebugger({
      agent:   deps.agent,
      sandbox: deps.sandbox,
      getDebugAdapter: (lid: string) => {
        try { return deps.pluginRegistry.get(lid).getDebugAdapter(); } catch { return null; }
      },
      getLaunchConfig: (lid: string, _repoPath: string) => {
        try { const cfg = deps.pluginRegistry.get(lid).getDebugLaunchConfig(deps.repoPath); return cfg as import('@tacv/debugger').BreakpointStrategy extends never ? never : { type: string; launchCmd: string; cwd: string; debugPort: number }; } catch { return null; }
      },
      actuatorBaseUrl: deps.config.debug.actuatorBaseUrl,
      frontendBaseUrl: deps.config.frontendBaseUrl,
      userJavaPackage: deps.config.debug.userJavaPackage,
      userTsSrcRoot:   deps.config.debug.userTsSrcRoot,
    });

    const observations = await debugger_.debug(state);
    log.info('debugger_activity.complete', { errorType: observations.errorType, hits: observations.breakpointHits.length });

    return {
      ...state,
      currentPhase:      'ACTOR',
      debugObservations: observations,
      workflowAuditTrail: [...state.workflowAuditTrail, {
        timestampMs: Date.now(), node: 'intelligent_debugger',
        decision:    `debug_complete_${observations.errorType}`,
        keyValues:   { errorType: observations.errorType, frames: observations.prunedStack.length, hits: observations.breakpointHits.length },
      }],
    };
  } catch (err) {
    log.error('debugger_activity.failed', { error: String(err) });
    // Fallback: text-only analysis without live debugging
    return _fallbackTextAnalysis(state, deps);
  }
}

async function _fallbackTextAnalysis(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  const failures = state.verifierVerdict?.testFailures ?? [];
  const rawOutput = failures.map(f => f.message).join('\n');

  let rootCause = '';
  try {
    const result = await deps.agent.runTask(
      `Task: ${state.task.description}\n\nTest failures:\n${rawOutput.slice(0, 1000)}\n\nIdentify the root cause in one paragraph.`,
      {},
      { role: 'debug_analyst', systemPrompt: 'You are a debugging expert. Identify root causes from stack traces.', maxTurns: 1, allowedTools: [] },
      state.cumulativeCostUsd,
    );
    rootCause = result.content.trim().slice(0, 500);
  } catch { /* non-critical */ }

  return {
    ...state,
    currentPhase: 'ACTOR',
    debugObservations: {
      errorType:           'UNKNOWN',
      rootCause:           rootCause || '(text analysis only — live debug unavailable)',
      breakpointHits:      [],
      actuatorBeans:       null,
      actuatorEnv:         null,
      minimalPayload:      null,
      playwrightTracePath: null,
      prunedStack:         [],
    },
    workflowAuditTrail: [...state.workflowAuditTrail, {
      timestampMs: Date.now(), node: 'intelligent_debugger',
      decision: 'fallback_text_analysis', keyValues: { rootCauseLen: rootCause.length },
    }],
  };
}
