import type {
  TestResult, ApiTestResult, MutationResult, AstDiffResult,
  ErrorType, IDebugAdapter, DebugLaunchConfig, StackFrame,
} from '@tacv/contracts';

// Re-export shared types so existing consumers don't need to update their imports
export type {
  TestResult, ApiTestResult, MutationResult, AstDiffResult,
  ErrorType, IDebugAdapter, DebugLaunchConfig, StackFrame,
};

// ── Structural metadata ──────────────────────────────────────────────────────

export interface LanguagePluginMetadata {
  readonly languageId:    string;
  readonly displayName:   string;
  readonly extensions:    readonly string[];
  readonly testFramework: string;
  readonly buildTool:     string;
}

// ── Build / lint / test result types ────────────────────────────────────────

export interface BuildResult   { success: boolean; errors: string[]; warnings: string[]; durationMs: number }
export interface LintViolation { file: string; message: string; line: number | null; ruleId: string; resolutionHint: string }
export interface LintResult    { violations: LintViolation[]; durationMs: number }
export interface TestScaffold  { testFilePath: string; testContent: string; framework: string }
export interface TestSkeletonContext {
  primaryBehaviourDescription: string;
  methodName?: string;
  functionName?: string;
  scenarioName?: string;
}
export interface ApiTestOptions  { timeout?: number }
export interface MutationOptions { timeout?: number }
export interface BenchmarkResult { benchmarks: Array<{ name: string; file: string; opsPerSec: number }> }

// ── Framework profile ────────────────────────────────────────────────────────

export interface IFrameworkProfile {
  readonly profileId:   string;
  readonly displayName: string;
  readonly languageId:  string;
  matches(filePath: string): boolean;
  generateTestTemplate(sourceFile: string, context: TestSkeletonContext): TestScaffold;
  generateE2eTestTemplate?(feature: string, route: string): TestScaffold;
  getActorHints(): string;
  getLintRules(): Array<{ id: string; description: string }>;
}

// ── NEW: structural syntax metadata ─────────────────────────────────────────

/** Package ecosystem name used when querying vulnerability/dependency databases. */
export type PackageEcosystem = 'npm' | 'maven' | 'gradle' | 'pip' | 'go' | 'cargo' | 'nuget' | 'rubygems';

/**
 * Language-specific structural metadata. Returned by `ILanguagePlugin.getSyntaxInfo()`.
 * Consumers (critics, analyzers, strategy selectors) use this instead of
 * hardcoding `if (languageId === 'java')` switches.
 */
export interface LanguageSyntaxInfo {
  /**
   * Regex matching controller / route / endpoint files.
   * `null` if the language has no such concept.
   */
  readonly controllerFilePattern:  RegExp | null;

  /** Primary dependency manifest filename, e.g. `'package.json'` or `'pom.xml'`. */
  readonly dependencyManifestFile: string;

  /** Package ecosystem, used for advisory lookups. */
  readonly packageEcosystem:       PackageEcosystem;

  /** Regex matching test/spec files for this language. */
  readonly testFilePattern:        RegExp;

  /**
   * Regex with capture group 1 = exported/public function or method name.
   * Used by the compatibility critic to detect deleted public APIs.
   * Must use the `gm` flags so `matchAll` works correctly.
   */
  readonly publicMethodPattern:    RegExp;

  /**
   * Regex with capture group 1 = class / struct / interface name.
   * Must use the `gm` flags.
   */
  readonly classPattern:           RegExp;

  /** Default HTTP port when the application runs in dev/test mode. */
  readonly defaultApplicationPort: number;
}

// ── NEW: stack parsing ───────────────────────────────────────────────────────

/**
 * Language-specific stack frame parser.
 * Returned by `ILanguagePlugin.createStackParser()`.
 * Each plugin provides its own implementation; `@tacv/debugger` calls it
 * instead of maintaining hardcoded `_parseJavaStack` / `_parseTsStack` branches.
 */
export interface IStackParser {
  parseAndPrune(rawOutput: string, moduleType: string): StackFrame[];
}

// ── NEW: debug adapter spec ──────────────────────────────────────────────────

/** Wire protocol for the debug session. */
export type DebugProtocol = 'cdp' | 'jdwp' | 'dap' | 'none';

/**
 * Declarative description of how to start and connect a debug session.
 * `@tacv/debugger` uses `DebugAdapterFactory.create(spec)` to turn this into
 * a live `IDebugAdapter`, keeping adapter instantiation out of the plugin.
 *
 * Replaces the broken `getDebugAdapter()` that returned a fake stub.
 */
export interface DebugAdapterSpec {
  readonly protocol:             DebugProtocol;
  readonly defaultPort:          number;
  /**
   * Shell command template that launches the process in debug-suspend mode.
   * The literal `${port}` will be substituted with `defaultPort` (or any
   * override) at launch time.
   *
   * Examples:
   *   `"node --inspect-brk=0.0.0.0:${port}"`
   *   `"mvn test -Dmaven.surefire.debug='-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=*:${port}'"`
   */
  readonly launchCmdTemplate:    string;
}

// ── Options for createStackParser ────────────────────────────────────────────

export interface StackParserOptions {
  /** Root directory containing user source files (used to distinguish user vs framework frames). */
  readonly userRoot?:          string;
  /** Language-specific package prefix (Java: `'com.example'`). */
  readonly userPackagePrefix?: string;
}

// ── ILanguagePlugin ──────────────────────────────────────────────────────────

export interface ILanguagePlugin {
  readonly metadata: LanguagePluginMetadata;

  // ── build / verify ────────────────────────────────────────────────────────
  build(repoPath: string, options?: Record<string, unknown>): Promise<BuildResult>;
  typeCheck(repoPath: string, changedFiles: string[]): Promise<LintResult>;
  runProtectionTests(repoPath: string, options?: { testFiles?: string[]; timeout?: number }): Promise<TestResult>;
  runAcceptanceTests(repoPath: string, testFiles: string[], options?: { timeout?: number; failFast?: boolean }): Promise<TestResult>;
  runApiTests(repoPath: string, options?: ApiTestOptions): Promise<ApiTestResult>;
  runMutationTests(repoPath: string, testFiles: string[], options?: MutationOptions): Promise<MutationResult>;
  runBenchmarks(repoPath: string, affectedFiles: string[]): Promise<BenchmarkResult>;
  generateTestSkeleton(sourceFile: string, context: TestSkeletonContext): Promise<TestScaffold>;
  lint(repoPath: string, changedFiles: string[]): Promise<LintResult>;
  format(content: string, filePath: string): Promise<string>;
  checkArchRules(repoPath: string): Promise<LintResult>;
  detectDeletedTests(diffContent: string): string[];

  // ── framework profile ─────────────────────────────────────────────────────
  getProfileFor(filePath: string): IFrameworkProfile | null;

  // ── NEW structural query API (replaces all `if languageId === 'java'` ─────
  /** Structural metadata for critics, analyzers, and test file detection. */
  getSyntaxInfo(): LanguageSyntaxInfo;

  /**
   * Error patterns for output classification.
   * Each entry: `[regexes, ErrorType]`. Evaluated in order; first match wins.
   * The debugger uses this instead of its own hardcoded pattern arrays.
   */
  getErrorPatterns(): Array<[RegExp[], ErrorType]>;

  /**
   * Creates a language-specific stack frame parser.
   * Called once per debug session; options come from `WorkflowConfig.languageConfig`.
   */
  createStackParser(options?: StackParserOptions): IStackParser;

  /**
   * Declarative debug adapter configuration.
   * Returns `null` if this language does not support live debugging.
   *
   * Replaces `getDebugAdapter()` (which returned a fake stub) and
   * `getDebugLaunchConfig()` (which is now embedded in the spec).
   */
  getDebugAdapterSpec(): DebugAdapterSpec | null;

  /**
   * @deprecated Use `getDebugAdapterSpec()` instead.
   * Kept for one release cycle to avoid a hard break in existing registrations.
   */
  getDebugAdapter?(): IDebugAdapter;
  /** @deprecated See `getDebugAdapterSpec()`. */
  getDebugLaunchConfig?(repoPath: string): DebugLaunchConfig;
}
