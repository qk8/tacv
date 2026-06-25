import type { ErrorType } from '@tacv/core/state';

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

const JAVA_PATTERNS: Array<[RegExp[], ErrorType]> = [
  [[/NullPointerException/],              'NULL_REFERENCE'],
  [[/ConcurrentModificationException/],   'CONCURRENT_MODIFICATION'],
  [[/OptimisticLockException/, /StaleObjectStateException/], 'OPTIMISTIC_LOCK'],
  [[/BeanCreationException/, /NoSuchBeanDefinitionException/, /UnsatisfiedDependencyException/], 'BEAN_CREATION_ERROR'],
  [[/ConstraintViolationException/, /MethodArgumentNotValidException/, /must not be blank/, /must not be null/], 'VALIDATION_ERROR'],
  [[/ClassCastException/],                'CLASS_CAST'],
  [[/StackOverflowError/],                'STACK_OVERFLOW'],
  [[/OutOfMemoryError/],                  'OUT_OF_MEMORY'],
];

const TS_PATTERNS: Array<[RegExp[], ErrorType]> = [
  [[/TypeError: Cannot read prop/, /TypeError: Cannot set prop/, /TypeError: undefined is not/, /TypeError: null is not/], 'NULL_REFERENCE'],
  [[/UnhandledPromiseRejection/, /UnhandledPromiseRejectionWarning/], 'ASYNC_PROMISE_UNHANDLED'],
  [[/setState called on unmounted/, /Can't perform a React state update/, /Invariant failed/], 'REACT_STATE_MISMATCH'],
  [[/race condition/, /concurrent/, /setInterval.*clearInterval/], 'ASYNC_RACE_CONDITION'],
  [[/Validation failed/, /must not be blank/], 'VALIDATION_ERROR'],
];

export function classifyError(rawOutput: string, langId: string): ErrorType {
  if (/\b400\b/.test(rawOutput) || rawOutput.includes('Bad Request')) return 'HTTP_400';
  if (/\b5[0-9]{2}\b/.test(rawOutput)) return 'LOGIC_ERROR';
  const patterns = langId === 'java' ? JAVA_PATTERNS : TS_PATTERNS;
  for (const [regexes, type] of patterns) {
    if (regexes.some(r => r.test(rawOutput))) return type;
  }
  return 'UNKNOWN';
}

const STRATEGIES: Record<ErrorType, DebugStrategy> = {
  NULL_REFERENCE:           { errorType: 'NULL_REFERENCE',           tool: 'breakpoint',   breakpointOffset: -1, stepType: 'step_over', maxSteps: 3,  evaluateExpressions: [], focusHint: 'Identify which variable is null one frame before the NPE.' },
  CONCURRENT_MODIFICATION:  { errorType: 'CONCURRENT_MODIFICATION',  tool: 'breakpoint',   breakpointOffset: 0,  stepType: 'step_into', maxSteps: 5,  evaluateExpressions: [], conditionalBp: 'size > 0', focusHint: 'Find the mutation happening while iterating.' },
  OPTIMISTIC_LOCK:          { errorType: 'OPTIMISTIC_LOCK',          tool: 'breakpoint',   breakpointOffset: 0,  stepType: 'step_over', maxSteps: 3,  evaluateExpressions: ['entity.getVersion()'], focusHint: 'Inspect entity version at time of save.' },
  BEAN_CREATION_ERROR:      { errorType: 'BEAN_CREATION_ERROR',      tool: 'actuator',     breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Query /actuator/beans to inspect the DI graph.' },
  VALIDATION_ERROR:         { errorType: 'VALIDATION_ERROR',         tool: 'delta_debug',  breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Bisect request payload to find the offending field.' },
  ASYNC_RACE_CONDITION:     { errorType: 'ASYNC_RACE_CONDITION',     tool: 'log_only',     breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Add structured logging around concurrent operations.' },
  ASYNC_PROMISE_UNHANDLED:  { errorType: 'ASYNC_PROMISE_UNHANDLED',  tool: 'breakpoint',   breakpointOffset: 0,  stepType: 'step_over', maxSteps: 3,  evaluateExpressions: [], focusHint: 'Find the promise chain missing a catch handler.' },
  REACT_STATE_MISMATCH:     { errorType: 'REACT_STATE_MISMATCH',     tool: 'playwright',   breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: ['window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size'], focusHint: 'Dump React component tree and Redux store state.' },
  CLASS_CAST:               { errorType: 'CLASS_CAST',               tool: 'breakpoint',   breakpointOffset: -1, stepType: 'step_over', maxSteps: 3,  evaluateExpressions: [], focusHint: 'Find where incorrect type assumption is made.' },
  STACK_OVERFLOW:           { errorType: 'STACK_OVERFLOW',           tool: 'log_only',     breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Identify the recursive call that lacks a base case.' },
  OUT_OF_MEMORY:            { errorType: 'OUT_OF_MEMORY',            tool: 'log_only',     breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Check for unbounded collections or missing pagination.' },
  TIMEOUT:                  { errorType: 'TIMEOUT',                  tool: 'actuator',     breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Check active threads and DB connection pool via Actuator.' },
  HTTP_400:                 { errorType: 'HTTP_400',                 tool: 'delta_debug',  breakpointOffset: 0,  stepType: 'none',      maxSteps: 0,  evaluateExpressions: [], focusHint: 'Bisect request payload to isolate validation failure.' },
  LOGIC_ERROR:              { errorType: 'LOGIC_ERROR',              tool: 'breakpoint',   breakpointOffset: 0,  stepType: 'step_over', maxSteps: 5,  evaluateExpressions: [], focusHint: 'Step through the logic path to find incorrect branch.' },
  UNKNOWN:                  { errorType: 'UNKNOWN',                  tool: 'breakpoint',   breakpointOffset: 0,  stepType: 'step_over', maxSteps: 5,  evaluateExpressions: [], focusHint: 'General inspection — dump all local variables at first user-code frame.' },
};

export function selectStrategy(errorType: ErrorType, _langId: string): DebugStrategy {
  return STRATEGIES[errorType] ?? STRATEGIES['UNKNOWN']!;
}
