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

  // ★ REDESIGN: pattern-based error type classification in fallback
  // The original hardcoded 'UNKNOWN'; now we classify from the stack trace text
  // so the actor receives a useful errorType even without live debugging.
  const errorType = classifyErrorType(rawOutput);

  return {
    ...state,
    currentPhase: 'ACTOR',
    debugObservations: {
      errorType:           errorType,
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

/** Pattern-based error type classification — used when live debug is unavailable. */
function classifyErrorType(rawOutput: string): string {
  const t = rawOutput.toLowerCase();

  // Java patterns
  if (/nullpointerexception|npe at /.test(t))          return 'NULL_REFERENCE';
  if (/beancreationexception|error creating bean/.test(t)) return 'BEAN_CREATION_ERROR';
  if (/classcastexception/.test(t))                    return 'TYPE_MISMATCH';
  if (/illegalargumentexception|illegal argument/.test(t)) return 'ILLEGAL_ARGUMENT';
  if (/indexoutofboundsexception|arrayindexoutofbounds/.test(t)) return 'INDEX_OUT_OF_BOUNDS';
  if (/stackoverflowerror|stack overflow/.test(t))     return 'STACK_OVERFLOW';
  if (/outofmemoryerror|java.lang.out of memory/.test(t)) return 'OUT_OF_MEMORY';
  if (/nosuchbeandefinitionexception|no qualifying bean/.test(t)) return 'BEAN_NOT_FOUND';
  if (/hibernateexception|transactionrequiredexception/.test(t)) return 'DATABASE_ERROR';
  if (/timeout|timed out/.test(t))                     return 'TIMEOUT';

  // TypeScript / JavaScript patterns
  if (/cannot read prop|cannot read properties of (undefined|null)/.test(t)) return 'NULL_REFERENCE';
  if (/typeerror/.test(t))                             return 'TYPE_MISMATCH';
  if (/referenceerror/.test(t))                        return 'REFERENCE_ERROR';
  if (/syntaxerror/.test(t))                           return 'SYNTAX_ERROR';
  if (/assertion.*failed|expected.*to.*be|assert\./.test(t)) return 'ASSERTION_FAILURE';
  if (/econnrefused|connection refused|econnreset/.test(t)) return 'NETWORK_ERROR';
  if (/ENOENT|no such file or directory/.test(t))      return 'FILE_NOT_FOUND';
  if (/permission denied|eacces/.test(t))              return 'PERMISSION_DENIED';

  return 'UNKNOWN';
}
