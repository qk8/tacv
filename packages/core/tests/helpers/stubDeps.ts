import type { ActivityDeps, LanguagePluginRegistry, ILanguagePluginMinimal } from '../../src/activities/ActivityDeps.js';
import type { WorkflowConfig } from '../../src/config/index.js';
import type { TestResult, ApiTestResult, MutationResult } from '../../src/state/schemas.js';

export const stubConfig: WorkflowConfig = {
  temporalAddress: 'localhost:7233', temporalNamespace: 'default', taskQueue: 'test',
  maxSelfCorrectionCycles: 6, maxReplanAttempts: 2, maxParallelBranches: 3,
  maxParallelCritics: 2, maxNodeTimeoutSec: 600, confidenceEscalationThreshold: 0.4,
  enableMultiModelCritics: false, frontendBaseUrl: 'http://localhost:3000', testTimeoutMs: 30_000,
  repoPath: '/tmp/tacv-test', agentModel: 'claude-haiku-4-5', agentsMdMaxChars: 4000,
  mem0VectorStore: 'in-memory', mem0Config: {},
  tokenBudget: { criticalDollar: 80, warningDollar: 50, costPerMInput: 5, costPerMOutput: 30 },
  debug: { userJavaPackage: 'com.example', userTsSrcRoot: 'src', jdwpPort: 5005, cdpPort: 9229, debugTimeoutSec: 30, maxDebugSteps: 10, actuatorBaseUrl: 'http://localhost:8080/actuator' },
  stagnation: { totalAbortForce: 3, driftRevisionLimit: 2, semanticSimilarityThreshold: 0.85 },
  shadowMode: { enabled: false, cronSchedule: '0 2 * * *', maxTasksPerRun: 3 },
  coverage: { minimumLineCoverage: 80, maxLineCoverageRegression: 2, maxBranchCoverageRegression: 2 },
  mutation: { enabled: false, minimumScore: 70, maxTestFiles: 10, timeoutSec: 120 },
  visual: { enabled: false, pixelThreshold: 0.02, maxDiffPercent: 1.0, baselineDir: 'visual-baselines', viewports: ['mobile','tablet','desktop'] },
  libraryDocs: { provider: 'disabled', maxTokens: 2000 },
  openApi: { enabled: false }, performance: { enabled: false, regressionThreshold: 0.20, timeoutSec: 60 },
  langfuse: { enabled: false },
};

const passTestResult: TestResult = { passed: true, totalTests: 5, failedTests: 0, failures: [], coverageReport: null, durationMs: 100 };
const passApiResult: ApiTestResult = { passed: true, totalTests: 3, failedTests: 0, failures: [], durationMs: 200 };
const passMutResult: MutationResult = { mutationScore: 85, totalMutants: 20, killedMutants: 17, survivedMutants: 3, weakTestFiles: [], durationMs: 1000 };

const stubPlugin: ILanguagePluginMinimal = {
  metadata: { languageId: 'typescript', extensions: ['.ts', '.tsx'] as const },
  build: async () => ({ success: true, errors: [] }),
  typeCheck: async () => ({ violations: [] }),
  runProtectionTests: async () => passTestResult,
  runAcceptanceTests: async () => passTestResult,
  runApiTests: async () => passApiResult,
  runMutationTests: async () => passMutResult,
  runBenchmarks: async () => ({ benchmarks: [] }),
  generateTestSkeleton: async (file: string) => ({ testFilePath: file.replace('.ts', '.test.ts'), testContent: '// stub test', framework: 'vitest' }),
  lint: async () => ({ violations: [] }),
  checkArchRules: async () => ({ violations: [] }),
  detectDeletedTests: () => [],
  getDebugAdapter: () => ({ name: 'stub' } as never),
  getDebugLaunchConfig: () => ({ type: 'stub', launchCmd: '', cwd: '.', debugPort: 9229 }),
  getProfileFor: () => null,
};

export function makeStubDeps(overrides: Partial<ActivityDeps> = {}): ActivityDeps {
  return {
    config: stubConfig,
    agent: { runTask: async () => ({ content: '{"diffs":[],"summary":"stub","testFilePaths":[]}', toolCalls: [], finishReason: 'end_turn', inputTokens: 100, outputTokens: 50, totalCostUsd: 0.001, callCostUsd: 0.001 }) },
    extractor: { extract: async (_p: string, schema: import('zod').ZodType) => { try { return schema.parse({}); } catch { return {} as never; } } },
    memory: {
      add: async () => 'id-1',
      search: async () => [],
      getAll: async () => [],
      delete: async () => undefined,
      deleteAll: async () => undefined,
    },
    sandbox: {
      warmContainer: async () => ({ containerId: 'ctr-1', workingDir: '/tmp', hostJdwpPort: 5005, hostCdpPort: 9229 }),
      execInContainer: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      destroyContainer: async () => undefined,
      validateImage: async () => undefined,
    },
    codeGraph: {
      getCallGraph: async () => ({ entryPoint: '', nodes: [], edges: [] }),
      getDependencySubgraph: async () => ({}),
      getBlastRadius: async () => ({ entryFiles: [], affectedFiles: [], dependencyDepth: 0, crossServiceImpact: [], schemaImpact: [], riskScore: 0 }),
      mapCodeToSchema: async () => ({}),
      getArchAlignment: async () => ({}),
      computeAstDiff: async () => ({ semanticChanges: [], breakingChangeCount: 0, safeChangeCount: 0 }),
      selectAffectedTests: async (_c: string[], tests: string[]) => tests,
    },
    libraryDocs: { resolve: async () => ({ libraries: [], tokenEstimate: 0 }), isEnabled: () => false },
    pluginRegistry: { get: () => stubPlugin, getForFile: () => stubPlugin } as LanguagePluginRegistry,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    repoPath: '/tmp/tacv-test', taskId: 'test-task', sessionId: 'test-session',
    ...overrides,
  } as ActivityDeps;
}
