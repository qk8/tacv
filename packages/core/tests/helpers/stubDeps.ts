import type { ActivityDeps, LanguagePluginRegistry, ILanguagePlugin } from '../../src/activities/ActivityDeps.js';
import type { WorkflowConfig } from '../../src/config/index.js';
import type { TestResult, ApiTestResult, MutationResult } from '../../src/state/schemas.js';
import type { LanguageSyntaxInfo } from '@tacv/language-plugins-base';

export const stubConfig: WorkflowConfig = {
  temporalAddress: 'localhost:7233', temporalNamespace: 'default', taskQueue: 'test',
  maxSelfCorrectionCycles: 6, maxReplanAttempts: 2, maxParallelBranches: 3,
  maxParallelCritics: 2, maxNodeTimeoutSec: 600, confidenceEscalationThreshold: 0.4,
  enableMultiModelCritics: false, frontendBaseUrl: 'http://localhost:3000', testTimeoutMs: 30_000,
  repoPath: '/tmp/tacv-test', agentModel: 'claude-haiku-4-5', agentsMdMaxChars: 4000,
  mem0VectorStore: 'in-memory', mem0Config: {},
  tokenBudget: { criticalDollar: 80, warningDollar: 50, costPerMInput: 5, costPerMOutput: 30 },
  debug: { userJavaPackage: 'com.example', userTsSrcRoot: 'src', jdwpPort: 5005, cdpPort: 9229, debugTimeoutSec: 30, maxDebugSteps: 10, actuatorBaseUrl: 'http://localhost:8080/actuator' },
  languageConfig: {
    typescript: { debugPort: 9229, userSrcRoot: 'src' },
    java:       { debugPort: 5005, userPackage: 'com.example', actuatorBaseUrl: 'http://localhost:8080/actuator' },
  },
  stagnation: { totalAbortForce: 3, driftRevisionLimit: 2, semanticSimilarityThreshold: 0.85 },
  shadowMode: { enabled: false, cronSchedule: '0 2 * * *', maxTasksPerRun: 3 },
  coverage: { minimumLineCoverage: 80, maxLineCoverageRegression: 2, maxBranchCoverageRegression: 2 },
  mutation: { enabled: false, minimumScore: 70, maxTestFiles: 10, timeoutSec: 120, overrides: [] },
  visual: { enabled: false, pixelThreshold: 0.02, maxDiffPercent: 1.0, baselineDir: 'visual-baselines', viewports: ['mobile','tablet','desktop'] },
  libraryDocs: { provider: 'disabled', maxTokens: 2000 },
  openApi: { enabled: false }, performance: { enabled: false, regressionThreshold: 0.20, timeoutSec: 60 },
  langfuse: { enabled: false },
  incrementalTesting: { enabled: false, fastFeedbackMode: false },
  feasibility:  { enabled: true, ambiguityThreshold: 4, complexityThreshold: 5, model: 'claude-haiku-4-5-20251001' },
  flakiness:    { enabled: true, runCount: 3, passThreshold: 1.0 },
  testValidity: { enabled: true, triggerAfterCycles: 2, model: 'claude-opus-4-6' },
  baseline:     { enabled: true, failFast: true },
  planning:     { enabled: true, validateWithFastCritics: true, model: 'claude-haiku-4-5-20251001' },
  gitCheckpoint: { enabled: false, branchPrefix: 'tacv/', authorName: 'TACV Bot', authorEmail: 'tacv@automated' },
  criticLanes:  { alwaysRunSemantic: false, semanticLaneDeferCycles: 1 },
};

const passTestResult: TestResult = { passed: true, totalTests: 5, failedTests: 0, failures: [], coverageReport: null, durationMs: 100 };
const passApiResult: ApiTestResult = { passed: true, totalTests: 3, failedTests: 0, failures: [], durationMs: 200 };
const passMutResult: MutationResult = { mutationScore: 85, totalMutants: 20, killedMutants: 17, survivedMutants: 3, weakTestFiles: [], durationMs: 1000 };

function makeSyntaxInfo(languageId: string): LanguageSyntaxInfo {
  if (languageId === 'java') {
    return {
      controllerFilePattern:  /(Controller|Resource)\.java$/,
      dependencyManifestFile: 'pom.xml', packageEcosystem: 'maven',
      testFilePattern:        /(Test|IT)\.java$/,
      publicMethodPattern:    /public\s+[\w<>\[\]]+\s+(\w+)\s*\(/gm,
      classPattern:           /class\s+(\w+)/gm, defaultApplicationPort: 8080,
    };
  }
  return {
    controllerFilePattern:  /\/(routes|controllers)\/.*\.(ts|js)$/,
    dependencyManifestFile: 'package.json', packageEcosystem: 'npm',
    testFilePattern:        /\.(test|spec)\.(ts|tsx|js|jsx)$/,
    publicMethodPattern:    /export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=/gm,
    classPattern:           /class\s+(\w+)/gm, defaultApplicationPort: 3000,
  };
}

export const stubPlugin: ILanguagePlugin = {
  metadata: { languageId: 'typescript', displayName: 'TypeScript', extensions: ['.ts', '.tsx'] as const, testFramework: 'vitest', buildTool: 'tsc' },
  build:              async () => ({ success: true, errors: [], warnings: [], durationMs: 0 }),
  typeCheck:          async () => ({ violations: [], durationMs: 0 }),
  runProtectionTests: async () => passTestResult,
  runAcceptanceTests: async () => passTestResult,
  runApiTests:        async () => passApiResult,
  runMutationTests:   async () => passMutResult,
  runBenchmarks:      async () => ({ benchmarks: [{ name: 'getUserById', file: 'src/UserService.java', opsPerSec: 5000 }] }),
  generateTestSkeleton: async (file) => ({ testFilePath: file.replace('.ts', '.test.ts'), testContent: '// stub test', framework: 'vitest' }),
  lint:           async () => ({ violations: [], durationMs: 0 }),
  checkArchRules: async () => ({ violations: [], durationMs: 0 }),
  format:         async (c) => c,
  detectDeletedTests: () => [],
  // ★ New methods — all stubs return sane defaults
  getSyntaxInfo:     () => makeSyntaxInfo('typescript'),
  getErrorPatterns: () => [
    [[/NullPointerException/], 'NULL_REFERENCE' as const],
    [[/BeanCreationException/, /Error creating bean/], 'BEAN_CREATION_ERROR' as const],
    [[/ConstraintViolationException/], 'VALIDATION_ERROR' as const],
    [[/TypeError:\\s*Cannot read prop/, /TypeError:\\s*Cannot read properties/], 'NULL_REFERENCE' as const],
    [[/UnhandledPromiseRejection/], 'ASYNC_PROMISE_UNHANDLED' as const],
  ],
  createStackParser: () => ({ parseAndPrune: () => [] }),
  getDebugAdapterSpec: () => ({ protocol: 'cdp', defaultPort: 9229, launchCmdTemplate: 'node --inspect-brk=${port}' }),
  getProfileFor:     () => null,
} as ILanguagePlugin;

export function makeStubPlugin(languageId: string): ILanguagePlugin {
  const patterns: Array<[RegExp[], import('@tacv/contracts').ErrorType]> = languageId === 'java'
    ? [
        [[/NullPointerException/], 'NULL_REFERENCE'],
        [[/BeanCreationException/, /Error creating bean/], 'BEAN_CREATION_ERROR'],
        [[/ConstraintViolationException/], 'VALIDATION_ERROR'],
        [[/ConcurrentModificationException/], 'CONCURRENT_MODIFICATION'],
      ]
    : [
        [[/TypeError:\s*Cannot read prop/, /TypeError:\s*Cannot read properties/], 'NULL_REFERENCE'],
        [[/UnhandledPromiseRejection/], 'ASYNC_PROMISE_UNHANDLED'],
        [[/Can't perform a React state update/], 'REACT_STATE_MISMATCH'],
      ];
  return {
    ...stubPlugin,
    metadata: { ...stubPlugin.metadata, languageId },
    getSyntaxInfo: () => makeSyntaxInfo(languageId),
    getErrorPatterns: () => patterns,
  } as ILanguagePlugin;
}

export function makeStubDeps(overrides: Partial<ActivityDeps> = {}): ActivityDeps {
  return {
    config: stubConfig,
    agent: { runTask: async () => ({ content: '{\"diffs\":[],\"summary\":\"stub\",\"testFilePaths\":[]}', toolCalls: [], finishReason: 'end_turn', inputTokens: 100, outputTokens: 50, totalCostUsd: 0.001, callCostUsd: 0.001 }) },
    extractor: { extract: async (_p: string, schema: import('zod').ZodType) => { try { return schema.parse({}); } catch { return {} as never; } } },
    memory: { add: async () => 'id-1', search: async () => [], getAll: async () => [], delete: async () => undefined, deleteAll: async () => undefined },
    sandbox: {
      warmContainer: async () => ({ containerId: 'ctr-1', workingDir: '/tmp', hostJdwpPort: 5005, hostCdpPort: 9229 }),
      execInContainer: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      destroyContainer: async () => undefined, validateImage: async () => undefined,
    },
    codeGraph: {
      getCallGraph: async () => ({ entryPoint: '', nodes: [], edges: [] }),
      getDependencySubgraph: async () => ({}),
      getBlastRadius: async () => ({ entryFiles: [], affectedFiles: [], dependencyDepth: 0, crossServiceImpact: [], schemaImpact: [], riskScore: 0 }),
      mapCodeToSchema: async () => ({}), getArchAlignment: async () => ({}),
      computeAstDiff: async () => ({ semanticChanges: [], breakingChangeCount: 0, safeChangeCount: 0 }),
      selectAffectedTests: async (_c: string[], tests: string[]) => tests,
    },
    libraryDocs: { resolve: async () => ({ libraries: [], tokenEstimate: 0 }), isEnabled: () => false },
    pluginRegistry: {
      get:           (id) => makeStubPlugin(id),
      getForFile:    (_)  => stubPlugin,
      getForExtension: (_) => stubPlugin,
      getAll:        ()   => [stubPlugin],
      has:           (_)  => true,
    } as LanguagePluginRegistry,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    repoPath: '/tmp/tacv-test', taskId: 'test-task', sessionId: 'test-session',
    heartbeat: () => {}, // no-op by default
    ...overrides,
  } as ActivityDeps;
}
