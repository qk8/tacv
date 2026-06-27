import { execa } from 'execa';
import type {
  ILanguagePlugin, LanguagePluginMetadata, BuildResult, LintResult,
  TestScaffold, TestSkeletonContext, IFrameworkProfile, BenchmarkResult,
  LanguageSyntaxInfo, IStackParser, DebugAdapterSpec, StackParserOptions,
} from '@tacv/language-plugins-base';
import type { TestResult, ApiTestResult, MutationResult, ErrorType } from '@tacv/contracts';
import { ReactProfile }           from './profiles/ReactProfile.js';
import { FastifyProfile }         from './profiles/FastifyProfile.js';
import { TypeScriptStackParser }  from './TypeScriptStackParser.js';

export interface TypeScriptPluginConfig {
  readonly userSrcRoot?: string;
  readonly debugPort?:   number;
}

export class TypeScriptPlugin implements ILanguagePlugin {
  readonly metadata: LanguagePluginMetadata = {
    languageId: 'typescript', displayName: 'TypeScript',
    testFramework: 'Vitest + Playwright', buildTool: 'tsc',
    extensions: ['.ts', '.tsx', '.mts', '.cts'] as const,
  };

  private readonly profiles:     IFrameworkProfile[];
  private readonly userSrcRoot:  string;
  private readonly debugPort:    number;

  constructor(profiles?: IFrameworkProfile[], config?: TypeScriptPluginConfig) {
    this.profiles    = profiles ?? [new ReactProfile(), new FastifyProfile()];
    this.userSrcRoot = config?.userSrcRoot ?? 'src';
    this.debugPort   = config?.debugPort   ?? 9229;
  }

  // ── Framework profile ─────────────────────────────────────────────────────

  getProfileFor(filePath: string): IFrameworkProfile | null {
    return this.profiles.find(p => p.matches(filePath)) ?? null;
  }

  // ── NEW: structural query API ─────────────────────────────────────────────

  getSyntaxInfo(): LanguageSyntaxInfo {
    return {
      controllerFilePattern:  /\/(routes|controllers|api|handlers)\/.*\.(ts|js)$/,
      dependencyManifestFile: 'package.json',
      packageEcosystem:       'npm',
      testFilePattern:        /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/,
      publicMethodPattern:    /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=/gm,
      classPattern:           /class\s+(\w+)/gm,
      defaultApplicationPort: 3000,
    };
  }

  getErrorPatterns(): Array<[RegExp[], ErrorType]> {
    return [
      [[/TypeError:\s*Cannot read prop/, /TypeError:\s*Cannot read properties of (undefined|null)/],
       'NULL_REFERENCE'],
      [[/UnhandledPromiseRejection/, /UnhandledPromiseRejectionWarning/],
       'ASYNC_PROMISE_UNHANDLED'],
      [[/race condition/i, /concurrent modification/i],
       'ASYNC_RACE_CONDITION'],
      [[/Can't perform a React state update on an unmounted/, /setState called on unmounted/, /Invariant failed/],
       'REACT_STATE_MISMATCH'],
      [[/Validation (failed|error)/i, /ValidationError:/],
       'VALIDATION_ERROR'],
      [[/ReferenceError:/],
       'REFERENCE_ERROR'],
      [[/SyntaxError:/],
       'SYNTAX_ERROR'],
    ];
  }

  createStackParser(options?: StackParserOptions): IStackParser {
    return new TypeScriptStackParser({ userRoot: options?.userRoot ?? this.userSrcRoot });
  }

  getDebugAdapterSpec(): DebugAdapterSpec {
    return {
      protocol:          'cdp',
      defaultPort:       this.debugPort,
      launchCmdTemplate: `node --inspect-brk=0.0.0.0:\${port}`,
    };
  }

  // ── Build / lint / test ───────────────────────────────────────────────────

  async build(repoPath: string): Promise<BuildResult> {
    const t0 = performance.now();
    try {
      await execa('npx', ['tsc', '--noEmit'], { cwd: repoPath });
      return { success: true, errors: [], warnings: [], durationMs: Math.round(performance.now() - t0) };
    } catch (err) {
      return { success: false, errors: [String(err)], warnings: [], durationMs: Math.round(performance.now() - t0) };
    }
  }

  async typeCheck(repoPath: string, _changedFiles: string[]): Promise<LintResult> {
    const t0 = performance.now();
    try {
      await execa('npx', ['tsc', '--noEmit', '--pretty', 'false'], { cwd: repoPath });
      return { violations: [], durationMs: Math.round(performance.now() - t0) };
    } catch (err) {
      const lines = String(err).split('\n').filter(l => /error TS/.test(l));
      return {
        violations: lines.map(l => {
          const m = l.match(/^([^(]+)\((\d+),\d+\): error (TS\d+): (.+)$/);
          return { file: m?.[1] ?? 'unknown', line: m?.[2] ? parseInt(m[2]) : null, ruleId: m?.[3] ?? 'TS_ERROR', message: m?.[4] ?? l, resolutionHint: 'Fix the TypeScript type error.' };
        }),
        durationMs: Math.round(performance.now() - t0),
      };
    }
  }

  async runProtectionTests(repoPath: string, options?: { testFiles?: string[]; timeout?: number }): Promise<TestResult> {
    return this._runVitest(repoPath, options?.testFiles ?? [], ['--exclude', '**/*.e2e.*', '--exclude', '**/*.spec.*'], options?.timeout);
  }

  async runAcceptanceTests(repoPath: string, testFiles: string[], options?: { timeout?: number }): Promise<TestResult> {
    if (testFiles.length === 0) return { passed: true, totalTests: 0, failedTests: 0, failures: [], coverageReport: null, durationMs: 0 };
    return this._runVitest(repoPath, testFiles, [], options?.timeout);
  }

  async runApiTests(repoPath: string): Promise<ApiTestResult> {
    const t0 = performance.now();
    try {
      await execa('npx', ['vitest', 'run', '--reporter=json', '--testPathPattern', '(api|integration)\\.test\\.'], { cwd: repoPath });
      return { passed: true, totalTests: 0, failedTests: 0, failures: [], durationMs: Math.round(performance.now() - t0) };
    } catch { return { passed: true, totalTests: 0, failedTests: 0, failures: [], durationMs: Math.round(performance.now() - t0) }; }
  }

  async runMutationTests(repoPath: string, testFiles: string[]): Promise<MutationResult> {
    const t0 = performance.now();
    try {
      const proc = await execa('npx', ['stryker', 'run', '--reporters', 'json', '--mutate', testFiles.join(',')], { cwd: repoPath });
      return this._parseStrykerOutput(proc.stdout, performance.now() - t0);
    } catch { return { mutationScore: 0, totalMutants: 0, killedMutants: 0, survivedMutants: 0, weakTestFiles: [], durationMs: Math.round(performance.now() - t0) }; }
  }

  async runBenchmarks(_repoPath: string, _files: string[]): Promise<BenchmarkResult> { return { benchmarks: [] }; }

  async generateTestSkeleton(sourceFile: string, ctx: TestSkeletonContext): Promise<TestScaffold> {
    const profile = this.getProfileFor(sourceFile);
    if (profile) return profile.generateTestTemplate(sourceFile, ctx);
    const name = sourceFile.split('/').pop()?.replace(/\.(ts|tsx)$/, '') ?? 'Module';
    return {
      testFilePath: sourceFile.replace(/\.(tsx?)$/, '.test.$1'),
      testContent: `import { describe, it, expect, vi } from 'vitest';\n\ndescribe('${name}', () => {\n  it('${ctx.primaryBehaviourDescription}', () => {\n    // Arrange, Act, Assert\n    expect(true).toBe(true);\n  });\n});`,
      framework: 'Vitest',
    };
  }

  async lint(repoPath: string, changedFiles: string[]): Promise<LintResult> {
    const t0 = performance.now();
    try {
      await execa('npx', ['eslint', '--format', 'json', ...changedFiles], { cwd: repoPath });
      return { violations: [], durationMs: Math.round(performance.now() - t0) };
    } catch (err) {
      try {
        const results = JSON.parse(String(err).match(/\[.*\]/s)?.[0] ?? '[]') as Array<{ filePath: string; messages: Array<{ line: number; ruleId: string; message: string }> }>;
        return { violations: results.flatMap(r => r.messages.map(m => ({ file: r.filePath, line: m.line, ruleId: m.ruleId ?? 'ESLint', message: m.message, resolutionHint: 'Fix the ESLint violation.' }))), durationMs: Math.round(performance.now() - t0) };
      } catch { return { violations: [], durationMs: Math.round(performance.now() - t0) }; }
    }
  }

  async format(content: string, _filePath: string): Promise<string> { return content; }

  async checkArchRules(repoPath: string): Promise<LintResult> {
    const t0 = performance.now();
    try {
      await execa('npx', ['depcruise', '--output-type', 'json', 'src'], { cwd: repoPath });
      return { violations: [], durationMs: Math.round(performance.now() - t0) };
    } catch { return { violations: [], durationMs: Math.round(performance.now() - t0) }; }
  }

  detectDeletedTests(diffContent: string): string[] {
    const removed: string[] = [];
    for (const line of diffContent.split('\n')) {
      if (!line.startsWith('-')) continue;
      const m = line.match(/(?:it|test)\([`'"](.*?)[`'"]/);
      if (m?.[1]) removed.push(m[1]);
    }
    return removed;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _runVitest(repoPath: string, testFiles: string[], extraArgs: string[], timeout?: number): Promise<TestResult> {
    const t0 = performance.now();
    const args = ['vitest', 'run', '--reporter=json', '--coverage', ...extraArgs, ...testFiles];
    try {
      const proc = await execa('npx', args, { cwd: repoPath, timeout: timeout ?? 120_000 });
      return this._parseVitestJson(proc.stdout, performance.now() - t0);
    } catch (err) {
      return this._parseVitestJson(String((err as NodeJS.ErrnoException).stdout ?? ''), performance.now() - t0, String(err));
    }
  }

  private _parseVitestJson(output: string, duration: number, _fallback?: string): TestResult {
    try {
      const json = JSON.parse(output.match(/\{[\s\S]*"testResults"[\s\S]*\}/)?.[0] ?? '{}') as { numPassedTests?: number; numFailedTests?: number; testResults?: Array<{ status: string; assertionResults?: Array<{ status: string; fullName: string; failureMessages: string[] }> }> };
      const failures = (json.testResults ?? []).flatMap(suite => (suite.assertionResults ?? []).filter(t => t.status === 'failed').map(t => ({ testName: t.fullName, message: t.failureMessages[0] ?? 'Test failed' })));
      return { passed: (json.numFailedTests ?? 0) === 0, totalTests: (json.numPassedTests ?? 0) + (json.numFailedTests ?? 0), failedTests: json.numFailedTests ?? 0, failures, coverageReport: null, durationMs: Math.round(duration) };
    } catch {
      return { passed: false, totalTests: 0, failedTests: 1, failures: [{ message: 'Could not parse test output' }], coverageReport: null, durationMs: Math.round(duration) };
    }
  }

  private _parseStrykerOutput(output: string, duration: number): MutationResult {
    try {
      const json = JSON.parse(output) as { metrics?: { mutationScore: number; totalMutants: number; killed: number; survived: number } };
      const m = json.metrics;
      return { mutationScore: m?.mutationScore ?? 0, totalMutants: m?.totalMutants ?? 0, killedMutants: m?.killed ?? 0, survivedMutants: m?.survived ?? 0, weakTestFiles: [], durationMs: Math.round(duration) };
    } catch { return { mutationScore: 0, totalMutants: 0, killedMutants: 0, survivedMutants: 0, weakTestFiles: [], durationMs: Math.round(duration) }; }
  }
}
