import type { TestResult, ApiTestResult, MutationResult, AstDiffResult } from '@tacv/core/state';
import type { IDebugAdapter, DebugLaunchConfig } from '@tacv/core/interfaces';

export interface LanguagePluginMetadata {
  readonly languageId:    string;
  readonly displayName:   string;
  readonly extensions:    readonly string[];
  readonly testFramework: string;
  readonly buildTool:     string;
}

export interface BuildResult { success: boolean; errors: string[]; warnings: string[]; durationMs: number }
export interface LintViolation { file: string; message: string; line: number | null; ruleId: string; resolutionHint: string }
export interface LintResult { violations: LintViolation[]; durationMs: number }
export interface TestScaffold { testFilePath: string; testContent: string; framework: string }
export interface TestSkeletonContext {
  primaryBehaviourDescription: string;
  methodName?: string;
  functionName?: string;
  scenarioName?: string;
}
export interface ApiTestOptions { timeout?: number }
export interface MutationOptions { timeout?: number }
export interface BenchmarkResult { benchmarks: Array<{ name: string; file: string; opsPerSec: number }> }

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

export interface ILanguagePlugin {
  readonly metadata: LanguagePluginMetadata;
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
  getDebugAdapter(): IDebugAdapter;
  getDebugLaunchConfig(repoPath: string): DebugLaunchConfig;
  getProfileFor(filePath: string): IFrameworkProfile | null;
}
