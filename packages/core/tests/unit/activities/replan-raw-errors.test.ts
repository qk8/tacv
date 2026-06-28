import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createInitialState } from '../../../src/state/schemas.js';
import { checkStagnationImpl } from '../../../src/activities/stagnation/impl.js';
import { replanImpl } from '../../../src/activities/replan/impl.js';
import type { ActivityDeps } from '../../../src/activities/ActivityDeps.js';
import type { WorkflowConfig } from '../../../src/config/index.js';
import type { IStructuredExtractor, IAgentProvider, IMemoryProvider, ISandboxProvider, ICodeGraphProvider, ILibraryDocsProvider } from '../../../src/activities/ActivityDeps.js';
import type { ILanguagePlugin } from '@tacv/language-plugins-base';

const task = { taskId: 'r1', description: 'Add payment processing', mode: 'BROWNFIELD' as const, moduleType: 'backend', languageIds: ['typescript'] };

// ── Helper: build a minimal deps with a capturable extractor ──────────────

function makeReplanDeps(capturedPrompt: string[]): ActivityDeps {
  const mockExtractor: IStructuredExtractor = {
    extract: async (_prompt: string, schema: import('zod').ZodType) => {
      // Capture the prompt for test assertions
      capturedPrompt.push(_prompt);
      try { return schema.parse({ newStrategies: [{ strategyId: 'new-1', description: 'new approach', compositeScore: 0.8, estimatedRisk: 'low' as const, affectedFiles: [] }], rationale: 'test' }); }
      catch { return {} as never; }
    },
  };
  const mockAgent: IAgentProvider = {
    runTask: async () => ({ content: '[]', toolCalls: [], finishReason: 'end_turn', inputTokens: 100, outputTokens: 50, totalCostUsd: 0.001, callCostUsd: 0.001 }),
  };
  const mockMemory: IMemoryProvider = { add: async () => 'id-1', search: async () => [], getAll: async () => [], delete: async () => undefined, deleteAll: async () => undefined };
  const mockSandbox: ISandboxProvider = {
    warmContainer: async () => ({ containerId: 'ctr-1', workingDir: '/tmp', hostJdwpPort: 5005, hostCdpPort: 9229 }),
    execInContainer: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    destroyContainer: async () => undefined, validateImage: async () => undefined,
  };
  const mockCodeGraph: ICodeGraphProvider = {
    getCallGraph: async () => ({ entryPoint: '', nodes: [], edges: [] }),
    getDependencySubgraph: async () => ({}),
    getBlastRadius: async () => ({ entryFiles: [], affectedFiles: [], dependencyDepth: 0, crossServiceImpact: [], schemaImpact: [], riskScore: 0 }),
    mapCodeToSchema: async () => ({}), getArchAlignment: async () => ({}),
    computeAstDiff: async () => ({ semanticChanges: [], breakingChangeCount: 0, safeChangeCount: 0 }),
    selectAffectedTests: async (_c: string[], tests: string[]) => tests,
  };
  const mockLibraryDocs: ILibraryDocsProvider = { resolve: async () => ({ libraries: [], tokenEstimate: 0 }), isEnabled: () => false };
  const mockPlugin: ILanguagePlugin = {
    metadata: { languageId: 'typescript', displayName: 'TypeScript', extensions: ['.ts'], testFramework: 'vitest', buildTool: 'tsc' },
    build: async () => ({ success: true, errors: [], warnings: [], durationMs: 0 }),
    typeCheck: async () => ({ violations: [], durationMs: 0 }),
    runProtectionTests: async () => ({ passed: true, totalTests: 5, failedTests: 0, failures: [], coverageReport: null, durationMs: 100 }),
    runAcceptanceTests: async () => ({ passed: true, totalTests: 5, failedTests: 0, failures: [], coverageReport: null, durationMs: 100 }),
    runApiTests: async () => ({ passed: true, totalTests: 3, failedTests: 0, failures: [], durationMs: 200 }),
    runMutationTests: async () => ({ mutationScore: 85, totalMutants: 20, killedMutants: 17, survivedMutants: 3, weakTestFiles: [], durationMs: 1000 }),
    runBenchmarks: async () => ({ benchmarks: [] }),
    generateTestSkeleton: async (f) => ({ testFilePath: f, testContent: '', framework: 'vitest' }),
    lint: async () => ({ violations: [], durationMs: 0 }),
    checkArchRules: async () => ({ violations: [], durationMs: 0 }),
    format: async (c) => c,
    detectDeletedTests: () => [],
    getSyntaxInfo: () => ({ controllerFilePattern: null, dependencyManifestFile: 'package.json', packageEcosystem: 'npm', testFilePattern: /\.(test|spec)\.(ts|tsx|js|jsx)$/, publicMethodPattern: /export\s+function\s+(\w+)/gm, classPattern: /class\s+(\w+)/gm, defaultApplicationPort: 3000 }),
    getErrorPatterns: () => [],
    createStackParser: () => ({ parseAndPrune: () => [] }),
    getDebugAdapterSpec: () => ({ protocol: 'cdp', defaultPort: 9229, launchCmdTemplate: 'node --inspect-brk=${port}' }),
    getProfileFor: () => null,
  } as ILanguagePlugin;
  const mockPluginRegistry = {
    get: (id: string) => mockPlugin, getForFile: () => mockPlugin, getForExtension: () => mockPlugin,
    getAll: () => [mockPlugin], has: () => true,
  };
  const mockConfig = {
    temporalAddress: 'localhost:7233', temporalNamespace: 'default', taskQueue: 'test',
    maxSelfCorrectionCycles: 6, maxReplanAttempts: 2, maxParallelBranches: 3,
    maxParallelCritics: 2, maxNodeTimeoutSec: 600, confidenceEscalationThreshold: 0.4,
    enableMultiModelCritics: false, frontendBaseUrl: 'http://localhost:3000', testTimeoutMs: 30_000,
    repoPath: '/tmp/tacv-test', agentModel: 'claude-haiku-4-5', agentsMdMaxChars: 4000,
    mem0VectorStore: 'in-memory', mem0Config: {},
    tokenBudget: { criticalDollar: 80, warningDollar: 50, costPerMInput: 5, costPerMOutput: 30 },
    debug: { userJavaPackage: 'com.example', userTsSrcRoot: 'src', jdwpPort: 5005, cdpPort: 9229, debugTimeoutSec: 30, maxDebugSteps: 10, actuatorBaseUrl: 'http://localhost:8080/actuator' },
    languageConfig: { typescript: { debugPort: 9229, userSrcRoot: 'src' }, java: { debugPort: 5005, userPackage: 'com.example', actuatorBaseUrl: 'http://localhost:8080/actuator' } },
    stagnation: { totalAbortForce: 3, driftRevisionLimit: 2, semanticSimilarityThreshold: 0.85 },
    shadowMode: { enabled: false, cronSchedule: '0 2 * * *', maxTasksPerRun: 3 },
    coverage: { minimumLineCoverage: 80, maxLineCoverageRegression: 2, maxBranchCoverageRegression: 2 },
    mutation: { enabled: false, minimumScore: 70, maxTestFiles: 10, timeoutSec: 120, overrides: [] },
    visual: { enabled: false, pixelThreshold: 0.02, maxDiffPercent: 1.0, baselineDir: 'visual-baselines', viewports: ['mobile','tablet','desktop'] },
    libraryDocs: { provider: 'disabled', maxTokens: 2000 },
    openApi: { enabled: false }, performance: { enabled: false, regressionThreshold: 0.20, timeoutSec: 60 },
    langfuse: { enabled: false },
    incrementalTesting: { enabled: false, fastFeedbackMode: false },
    feasibility: { enabled: true, ambiguityThreshold: 4, complexityThreshold: 5, model: 'claude-haiku-4-5-20251001' },
    flakiness: { enabled: true, runCount: 3, passThreshold: 1.0 },
    testValidity: { enabled: true, triggerAfterCycles: 2, model: 'claude-opus-4-6' },
    baseline: { enabled: true, failFast: true },
    planning: { enabled: true, validateWithFastCritics: true, model: 'claude-haiku-4-5-20251001' },
    gitCheckpoint: { enabled: false, branchPrefix: 'tacv/', authorName: 'TACV Bot', authorEmail: 'tacv@automated' },
    criticLanes: { alwaysRunSemantic: false, semanticLaneDeferCycles: 1 },
  } as WorkflowConfig;
  const mockLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

  return {
    config: mockConfig, agent: mockAgent, extractor: mockExtractor, memory: mockMemory,
    sandbox: mockSandbox, codeGraph: mockCodeGraph, libraryDocs: mockLibraryDocs,
    pluginRegistry: mockPluginRegistry, log: mockLog, repoPath: '/tmp/tacv-test',
    taskId: 'test-task', sessionId: 'test-session',
  };
}

describe('Bug 3: replan uses human-readable error messages', () => {
  it('CorrectionCycle schema includes rawErrorHistory field', () => {
    const state = createInitialState(task);
    expect((state.correctionCycle as Record<string, unknown>).rawErrorHistory).toBeDefined();
    expect(Array.isArray((state.correctionCycle as Record<string, unknown>).rawErrorHistory)).toBe(true);
  });

  it('replanImpl prompt includes raw error messages, not just hashes', async () => {
    const captured: string[] = [];
    const deps = makeReplanDeps(captured);

    const state = {
      ...createInitialState(task),
      correctionCycle: {
        ...createInitialState(task).correctionCycle,
        attemptCount: 3,
        errorHistory: ['a1b2c3d4', 'e5f6a7b8'], // hash-only history
        rawErrorHistory: ['TypeError: Cannot read properties of undefined (reading \'userId\')', 'AssertionError: expected 200 but got 500'],
      },
    };

    await replanImpl(state as never, deps);

    expect(captured.length).toBeGreaterThan(0);
    const prompt = captured[0];
    // The prompt must contain the readable error messages
    expect(prompt).toContain('Cannot read properties of undefined');
    expect(prompt).toContain('expected 200 but got 500');
    // It should NOT be just hex hashes
    expect(prompt).not.toContain('a1b2c3d4');
    expect(prompt).not.toContain('e5f6a7b8');
  });

  it('replanImpl falls back gracefully when rawErrorHistory is empty', async () => {
    const captured: string[] = [];
    const deps = makeReplanDeps(captured);

    const state = {
      ...createInitialState(task),
      correctionCycle: {
        ...createInitialState(task).correctionCycle,
        attemptCount: 1,
        errorHistory: ['hash1'],
        rawErrorHistory: [],
      },
    };

    await replanImpl(state as never, deps);
    expect(captured.length).toBeGreaterThan(0);
    // Should not throw even with empty rawErrorHistory
  });

  it('checkStagnationImpl populates rawErrorHistory in newCycle', () => {
    const msg = 'AssertionError: expected true but got false';
    const state = {
      ...createInitialState(task),
      correctionCycle: { ...createInitialState(task).correctionCycle, attemptCount: 1 },
      verifierVerdict: { testResult: 'FAIL' as const, diagnostic: 'FIX_IMPL' as const, testFailures: [{ message: msg }], blockedByCritic: false, confidenceScore: 0.9 },
    };
    const { newCycle } = checkStagnationImpl(state as never);
    expect(newCycle.rawErrorHistory).toBeDefined();
    expect(Array.isArray(newCycle.rawErrorHistory)).toBe(true);
    expect(newCycle.rawErrorHistory).toContain(msg);
  });
});
