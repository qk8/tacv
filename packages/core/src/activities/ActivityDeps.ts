import type { Logger } from 'pino';
import type { WorkflowConfig } from '../config/index.js';
import type { IAgentProvider }       from '../interfaces/IAgentProvider.js';
import type { IStructuredExtractor } from '../interfaces/IStructuredExtractor.js';
import type { IMemoryProvider }      from '../interfaces/IMemoryProvider.js';
import type { ISandboxProvider }     from '../interfaces/ISandboxProvider.js';
import type { ICodeGraphProvider }   from '../interfaces/ICodeGraphProvider.js';
import type { ILibraryDocsProvider } from '../interfaces/ILibraryDocsProvider.js';

export interface LanguagePluginRegistry {
  get(languageId: string): ILanguagePluginMinimal;
  getForFile(filePath: string): ILanguagePluginMinimal | null;
}

export interface ILanguagePluginMinimal {
  readonly metadata: { languageId: string; extensions: readonly string[] };
  build(repoPath: string): Promise<{ success: boolean; errors: string[] }>;
  typeCheck(repoPath: string, files: string[]): Promise<{ violations: Array<{ file: string; message: string; line: number | null; ruleId: string; resolutionHint: string }> }>;
  runProtectionTests(repoPath: string, opts?: { testFiles?: string[]; timeout?: number }): Promise<import('../state/schemas.js').TestResult>;
  runAcceptanceTests(repoPath: string, testFiles: string[], opts?: { timeout?: number; failFast?: boolean }): Promise<import('../state/schemas.js').TestResult>;
  runApiTests(repoPath: string): Promise<import('../state/schemas.js').ApiTestResult>;
  runMutationTests(repoPath: string, testFiles: string[]): Promise<import('../state/schemas.js').MutationResult>;
  runBenchmarks(repoPath: string, affectedFiles: string[]): Promise<{ benchmarks: Array<{ name: string; file: string; opsPerSec: number }> }>;
  generateTestSkeleton(sourceFile: string, context: Record<string, string>): Promise<{ testFilePath: string; testContent: string; framework: string }>;
  lint(repoPath: string, changedFiles: string[]): Promise<{ violations: Array<{ file: string; message: string; line: number | null; ruleId: string; resolutionHint: string }> }>;
  checkArchRules(repoPath: string): Promise<{ violations: Array<{ file: string; message: string; line: number | null; ruleId: string; resolutionHint: string }> }>;
  detectDeletedTests(diffContent: string): string[];
  getDebugAdapter(): import('../interfaces/IDebugAdapter.js').IDebugAdapter;
  getDebugLaunchConfig(repoPath: string): import('../interfaces/IDebugAdapter.js').DebugLaunchConfig;
  getProfileFor(filePath: string): IFrameworkProfileMinimal | null;
}

export interface IFrameworkProfileMinimal {
  readonly profileId: string;
  generateTestTemplate(sourceFile: string, context: Record<string, string>): { testFilePath: string; testContent: string; framework: string };
  generateE2eTestTemplate?(feature: string, route: string): { testFilePath: string; testContent: string; framework: string };
  getActorHints(): string;
}

export interface ActivityDeps {
  readonly config:         WorkflowConfig;
  readonly agent:          IAgentProvider;
  readonly extractor:      IStructuredExtractor;
  readonly memory:         IMemoryProvider;
  readonly sandbox:        ISandboxProvider;
  readonly codeGraph:      ICodeGraphProvider;
  readonly libraryDocs:    ILibraryDocsProvider;
  readonly pluginRegistry: LanguagePluginRegistry;
  readonly log:            Logger;
  readonly repoPath:       string;
  readonly taskId:         string;
  readonly sessionId:      string;
}
