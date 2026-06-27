import type { ErrorType } from '@tacv/contracts';
import type { ILanguagePlugin } from '@tacv/language-plugins-base';

export type DebugTool = 'breakpoint' | 'actuator' | 'delta_debug' | 'playwright' | 'log_only';

export interface DebugStrategy {
  errorType:           ErrorType;
  tool:                DebugTool;
  breakpointOffset:    number;
  stepType:            'step_over' | 'step_into' | 'none';
  maxSteps:            number;
  evaluateExpressions: string[];
  conditionalBp?:      string;
  focusHint:           string;
}

// ── Backward-compat built-in pattern tables ─────────────────────────────────
// These are consulted by `classifyError(rawOutput, langId)` for callers that
// haven't migrated to `classifyErrorWithPlugin()` yet.
// Plugin.getErrorPatterns() supersedes these in the new API.

const BUILTIN_PATTERNS: Record<string, Array<[RegExp[], ErrorType]>> = {
  java: [
    [[/NullPointerException/], 'NULL_REFERENCE'],
    [[/ConcurrentModificationException/], 'CONCURRENT_MODIFICATION'],
    [[/OptimisticLockException/, /StaleObjectStateException/], 'OPTIMISTIC_LOCK'],
    [[/BeanCreationException/, /NoSuchBeanDefinitionException/, /UnsatisfiedDependencyException/], 'BEAN_CREATION_ERROR'],
    [[/ConstraintViolationException/, /MethodArgumentNotValidException/, /must not be blank/, /must not be null/], 'VALIDATION_ERROR'],
    [[/ClassCastException/], 'CLASS_CAST'],
    [[/StackOverflowError/], 'STACK_OVERFLOW'],
    [[/OutOfMemoryError/], 'OUT_OF_MEMORY'],
  ],
  typescript: [
    [[/TypeError: Cannot read prop/, /TypeError: Cannot set prop/, /TypeError: undefined is not/, /TypeError: null is not/], 'NULL_REFERENCE'],
    [[/UnhandledPromiseRejection/, /UnhandledPromiseRejectionWarning/], 'ASYNC_PROMISE_UNHANDLED'],
    [[/setState called on unmounted/, /Can't perform a React state update/, /Invariant failed/], 'REACT_STATE_MISMATCH'],
    [[/race condition/, /concurrent/, /setInterval.*clearInterval/], 'ASYNC_RACE_CONDITION'],
    [[/Validation failed/, /must not be blank/], 'VALIDATION_ERROR'],
  ],
};

/**
 * Applies HTTP prefix guards then checks built-in pattern tables.
 * @deprecated Prefer `classifyErrorWithPlugin(rawOutput, plugin)`.
 */
export function classifyError(rawOutput: string, langId: string): ErrorType {
  const httpGuard = _applyHttpGuards(rawOutput);
  if (httpGuard) return httpGuard;
  const patterns = BUILTIN_PATTERNS[langId] ?? BUILTIN_PATTERNS['typescript']!;
  return _matchPatterns(rawOutput, patterns);
}

/**
 * Applies HTTP prefix guards then delegates pattern matching to the plugin.
 * This is the preferred API — it removes all language-specific knowledge from
 * the debugger and lets the plugin own its error vocabulary.
 */
export function classifyErrorWithPlugin(
  rawOutput: string,
  plugin: Pick<ILanguagePlugin, 'getErrorPatterns'>,
): ErrorType {
  const httpGuard = _applyHttpGuards(rawOutput);
  if (httpGuard) return httpGuard;
  return _matchPatterns(rawOutput, plugin.getErrorPatterns());
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _applyHttpGuards(rawOutput: string): ErrorType | null {
  if (/\b400\b/.test(rawOutput) || rawOutput.includes('Bad Request')) return 'HTTP_400';
  if (/\b5[0-9]{2}\b/.test(rawOutput)) return 'LOGIC_ERROR';
  return null;
}

function _matchPatterns(
  rawOutput: string,
  patterns: Array<[RegExp[], ErrorType]>,
): ErrorType {
  for (const [regexes, type] of patterns) {
    if (regexes.some(r => r.test(rawOutput))) return type;
  }
  return 'UNKNOWN';
}

// ── Strategy selection ───────────────────────────────────────────────────────

const STRATEGIES: Record<ErrorType, DebugStrategy> = {
  NULL_REFERENCE:          { errorType: 'NULL_REFERENCE',          tool: 'breakpoint',  breakpointOffset: -1, stepType: 'step_over', maxSteps: 3,  evaluateExpressions: [], focusHint: 'Identify which variable is null one frame before the NPE.' },
  CONCURRENT_MODIFICATION: { errorType: 'CONCURRENT_MODIFICATION', tool: 'breakpoint',  breakpointOffset: 0,  stepType: 'step_into', maxSteps: 5,  evaluateExpressions: [], conditionalBp: 'size > 0', focusHint: 'Find the mutation happening while iterating.' },
  OPTIMISTIC_LOCK:         { errorType: 'OPTIMISTIC_LOCK',         tool: 'breakpoint',  breakpointOffset: 0,  stepType: 'step_over', maxSteps: 3,  evaluateExpressions: ['entity.getVersion()'], focusHint: 'Inspect entity version at time of save.' },
  BEAN_CREATION_ERROR:     { errorType: 'BEAN_CREATION_ERROR',     tool: 'actuator',    breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Query /actuator/beans to inspect the DI graph.' },
  BEAN_NOT_FOUND:          { errorType: 'BEAN_NOT_FOUND',          tool: 'actuator',    breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Query /actuator/beans — a required bean is missing from the DI context.' },
  VALIDATION_ERROR:        { errorType: 'VALIDATION_ERROR',        tool: 'delta_debug', breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Bisect request payload to find the offending field.' },
  ASYNC_RACE_CONDITION:    { errorType: 'ASYNC_RACE_CONDITION',    tool: 'log_only',    breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Add structured logging around concurrent operations.' },
  ASYNC_PROMISE_UNHANDLED: { errorType: 'ASYNC_PROMISE_UNHANDLED', tool: 'breakpoint',  breakpointOffset: 0,  stepType: 'step_over', maxSteps: 3,  evaluateExpressions: [], focusHint: 'Find the promise chain missing a catch handler.' },
  REACT_STATE_MISMATCH:    { errorType: 'REACT_STATE_MISMATCH',    tool: 'playwright',  breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: ['window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size'], focusHint: 'Dump React component tree and Redux store state.' },
  CLASS_CAST:              { errorType: 'CLASS_CAST',              tool: 'breakpoint',  breakpointOffset: -1, stepType: 'step_over', maxSteps: 3,  evaluateExpressions: [], focusHint: 'Find where incorrect type assumption is made.' },
  STACK_OVERFLOW:          { errorType: 'STACK_OVERFLOW',          tool: 'log_only',    breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Identify the recursive call that lacks a base case.' },
  OUT_OF_MEMORY:           { errorType: 'OUT_OF_MEMORY',           tool: 'log_only',    breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Check for unbounded collections or missing pagination.' },
  TIMEOUT:                 { errorType: 'TIMEOUT',                 tool: 'actuator',    breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Check active threads and DB connection pool via Actuator.' },
  HTTP_400:                { errorType: 'HTTP_400',                tool: 'delta_debug', breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Bisect request payload to isolate validation failure.' },
  LOGIC_ERROR:             { errorType: 'LOGIC_ERROR',             tool: 'breakpoint',  breakpointOffset: 0,  stepType: 'step_over', maxSteps: 5,  evaluateExpressions: [], focusHint: 'Step through the logic path to find incorrect branch.' },
  TYPE_MISMATCH:           { errorType: 'TYPE_MISMATCH',           tool: 'breakpoint',  breakpointOffset: 0,  stepType: 'step_over', maxSteps: 3,  evaluateExpressions: [], focusHint: 'Inspect variable types at the point of mismatch.' },
  REFERENCE_ERROR:         { errorType: 'REFERENCE_ERROR',         tool: 'breakpoint',  breakpointOffset: 0,  stepType: 'step_over', maxSteps: 3,  evaluateExpressions: [], focusHint: 'Check variable scope and hoisting.' },
  SYNTAX_ERROR:            { errorType: 'SYNTAX_ERROR',            tool: 'log_only',    breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Fix the syntax error before debugging further.' },
  ILLEGAL_ARGUMENT:        { errorType: 'ILLEGAL_ARGUMENT',        tool: 'breakpoint',  breakpointOffset: -1, stepType: 'step_over', maxSteps: 3,  evaluateExpressions: [], focusHint: 'Inspect the argument value at the call site.' },
  INDEX_OUT_OF_BOUNDS:     { errorType: 'INDEX_OUT_OF_BOUNDS',     tool: 'breakpoint',  breakpointOffset: -1, stepType: 'step_over', maxSteps: 3,  evaluateExpressions: [], focusHint: 'Inspect the index and collection size.' },
  DATABASE_ERROR:          { errorType: 'DATABASE_ERROR',          tool: 'log_only',    breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Check DB logs and connection pool status.' },
  ASSERTION_FAILURE:       { errorType: 'ASSERTION_FAILURE',       tool: 'breakpoint',  breakpointOffset: -1, stepType: 'step_over', maxSteps: 3,  evaluateExpressions: [], focusHint: 'Inspect actual vs expected values before the assertion.' },
  NETWORK_ERROR:           { errorType: 'NETWORK_ERROR',           tool: 'log_only',    breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Check network config, firewall, and service availability.' },
  FILE_NOT_FOUND:          { errorType: 'FILE_NOT_FOUND',          tool: 'log_only',    breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Check file path resolution and working directory.' },
  PERMISSION_DENIED:       { errorType: 'PERMISSION_DENIED',       tool: 'log_only',    breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Check file/resource permissions and IAM roles.' },
  UNKNOWN:                 { errorType: 'UNKNOWN',                 tool: 'breakpoint',  breakpointOffset: 0,  stepType: 'step_over', maxSteps: 5,  evaluateExpressions: [], focusHint: 'General inspection — dump all local variables at first user-code frame.' },
};

export function selectStrategy(errorType: ErrorType, _langId: string): DebugStrategy {
  return STRATEGIES[errorType] ?? STRATEGIES['UNKNOWN']!;
}
