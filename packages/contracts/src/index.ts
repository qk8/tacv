/**
 * @tacv/contracts — zero-dependency shared domain types.
 *
 * Both @tacv/core and @tacv/language-plugins-base depend on this package,
 * breaking the circular dependency that previously forced ActivityDeps.ts
 * to maintain a hand-rolled copy of ILanguagePlugin (ILanguagePluginMinimal).
 */

// ── Test execution results ───────────────────────────────────────────────────

export interface TestFailure {
  readonly testName?: string;
  readonly message:   string;
  readonly file?:     string;
  readonly line?:     number;
}

export interface CoverageReport {
  readonly lines:      number;
  readonly branches:   number;
  readonly functions:  number;
  readonly statements: number;
}

export interface TestResult {
  readonly passed:         boolean;
  readonly totalTests:     number;
  readonly failedTests:    number;
  readonly failures:       TestFailure[];
  readonly coverageReport: CoverageReport | null;
  readonly durationMs:     number;
}

export interface ApiTestFailure extends TestFailure {
  readonly endpoint?:       string;
  readonly method?:         string;
  readonly expectedStatus?: number;
  readonly actualStatus?:   number;
}

export interface ApiTestResult {
  readonly passed:      boolean;
  readonly totalTests:  number;
  readonly failedTests: number;
  readonly failures:    ApiTestFailure[];
  readonly durationMs:  number;
}

export interface MutationResult {
  readonly mutationScore:   number;
  readonly totalMutants:    number;
  readonly killedMutants:   number;
  readonly survivedMutants: number;
  readonly weakTestFiles:   string[];
  readonly durationMs:      number;
}

// ── AST / code analysis ──────────────────────────────────────────────────────

export type SemanticChangeKind =
  | 'method_added' | 'method_removed' | 'method_modified'
  | 'class_added'  | 'class_removed'
  | 'field_added'  | 'field_removed';

export type BreakingRisk = 'none' | 'low' | 'medium' | 'high';

export interface SemanticChange {
  readonly file:         string;
  readonly kind:         SemanticChangeKind;
  readonly symbolName:   string;
  readonly description:  string;
  readonly breakingRisk: BreakingRisk;
}

export interface AstDiffResult {
  readonly semanticChanges:    SemanticChange[];
  readonly breakingChangeCount: number;
  readonly safeChangeCount:     number;
}

// ── Debug adapter protocol types ─────────────────────────────────────────────

export interface BreakpointLocation {
  readonly file: string;
  readonly line: number;
}

export interface VariableInfo {
  readonly value: unknown;
  readonly type:  string;
}

export interface DebugLaunchConfig {
  readonly type:      string;
  readonly launchCmd: string;
  readonly cwd:       string;
  readonly debugPort: number;
}

export interface IDebugAdapter {
  readonly name: string;
  connect(host: string, port: number): Promise<void>;
  disconnect(): Promise<void>;
  setBreakpoint(location: BreakpointLocation): Promise<void>;
  setConditionalBreakpoint(location: BreakpointLocation, condition: string): Promise<void>;
  resume(): Promise<void>;
  stepOver(): Promise<BreakpointHit | null>;
  stepInto(): Promise<BreakpointHit | null>;
  waitForBreakpointHit(timeoutMs: number): Promise<BreakpointHit | null>;
  getScopeVariables(): Promise<Record<string, VariableInfo>>;
  evaluate(expression: string): Promise<unknown>;
  getCallStack(): Promise<string[]>;
}

// ── Debug observations ───────────────────────────────────────────────────────

export interface BreakpointHit {
  readonly file:      string;
  readonly line:      number;
  readonly variables: Record<string, VariableInfo>;
  readonly callStack: string[];
  readonly threadId:  string;
}

export interface DebugObservations {
  readonly errorType:           ErrorType;
  readonly rootCause:           string;
  readonly breakpointHits:      BreakpointHit[];
  readonly actuatorBeans:       unknown | null;
  readonly actuatorEnv:         unknown | null;
  readonly minimalPayload:      Record<string, unknown> | null;
  readonly playwrightTracePath: string | null;
  readonly prunedStack:         StackFrame[];
}

export interface StackFrame {
  readonly file:    string;
  readonly line:    number;
  readonly method:  string;
  readonly isUser:  boolean;
}

// ── Error classification ─────────────────────────────────────────────────────

export const ALL_ERROR_TYPES = [
  'NULL_REFERENCE', 'CONCURRENT_MODIFICATION', 'OPTIMISTIC_LOCK',
  'BEAN_CREATION_ERROR', 'BEAN_NOT_FOUND', 'VALIDATION_ERROR', 'CLASS_CAST',
  'STACK_OVERFLOW', 'OUT_OF_MEMORY', 'TIMEOUT', 'HTTP_400', 'LOGIC_ERROR',
  'ASYNC_PROMISE_UNHANDLED', 'ASYNC_RACE_CONDITION', 'REACT_STATE_MISMATCH',
  'TYPE_MISMATCH', 'REFERENCE_ERROR', 'SYNTAX_ERROR',
  'ILLEGAL_ARGUMENT', 'INDEX_OUT_OF_BOUNDS', 'DATABASE_ERROR',
  'ASSERTION_FAILURE', 'NETWORK_ERROR', 'FILE_NOT_FOUND', 'PERMISSION_DENIED',
  'UNKNOWN',
] as const;

export type ErrorType = typeof ALL_ERROR_TYPES[number];

// ── Sandbox provider types ────────────────────────────────────────────────────

export interface SandboxHandle {
  readonly containerId:  string;
  readonly workingDir:   string;
  readonly hostJdwpPort: number;
  readonly hostCdpPort:  number;
}

export interface ExecOptions {
  timeoutMs?:  number;
  env?:        Record<string, string>;
  workingDir?: string;
}

export interface ExecResult {
  readonly stdout:   string;
  readonly stderr:   string;
  readonly exitCode: number;
}

export interface ISandboxProvider {
  warmContainer(options?: Record<string, unknown>): Promise<SandboxHandle>;
  execInContainer(handle: SandboxHandle, cmd: string, options?: ExecOptions): Promise<ExecResult>;
  destroyContainer(handle: SandboxHandle): Promise<void>;
  validateImage(imageName: string): Promise<void>;
}

// ── Agent provider types ──────────────────────────────────────────────────────

export interface AgentOptions {
  role:           string;
  systemPrompt:   string;
  maxTurns:       number;
  allowedTools:   string[];
  promptVersion?: string;
}

export interface AgentResult {
  content:       string;
  toolCalls:     unknown[];
  finishReason:  string;
  inputTokens:   number;
  outputTokens:  number;
  totalCostUsd:  number;
  callCostUsd:   number;
}

export interface IAgentProvider {
  runTask(
    prompt: string,
    context: Record<string, unknown>,
    options: AgentOptions,
    cumulativeCostUsd: number,
  ): Promise<AgentResult>;
}
