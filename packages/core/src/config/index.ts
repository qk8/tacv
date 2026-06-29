import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { createLogger } from '../observability/logger.js';

const log = createLogger('tacv.config');

export const TokenBudgetConfig = z.object({
  criticalDollar: z.number().positive().default(80),
  warningDollar:  z.number().positive().default(50),
  costPerMInput:  z.number().positive().default(5),
  costPerMOutput: z.number().positive().default(30),
});

export const DebugConfig = z.object({
  userJavaPackage: z.string().default('com.example'),
  userTsSrcRoot:   z.string().default('src'),
  jdwpPort:        z.number().int().default(5005),
  cdpPort:         z.number().int().default(9229),
  debugTimeoutSec: z.number().int().default(30),
  maxDebugSteps:   z.number().int().default(10),
  actuatorBaseUrl: z.string().default('http://localhost:8080/actuator'),
});

export const StagnationConfig = z.object({
  totalAbortForce:             z.number().int().default(3),
  driftRevisionLimit:          z.number().int().default(2),
  semanticSimilarityThreshold: z.number().min(0).max(1).default(0.85),
});

export const ShadowModeConfig = z.object({
  enabled: z.boolean().default(false),
  cronSchedule: z.string().default('0 2 * * *'),
  maxTasksPerRun: z.number().int().default(3),
});

export const CoverageConfig = z.object({
  minimumLineCoverage:         z.number().min(0).max(100).default(80),
  maxLineCoverageRegression:   z.number().min(0).max(10).default(2),
  maxBranchCoverageRegression: z.number().min(0).max(10).default(2),
});

// Per-module-criticality mutation overrides
export const MutationOverride = z.object({
  pattern:      z.string(),    // glob, e.g. "src/payments/**"
  minimumScore: z.number().min(0).max(100),
});

export const MutationConfig = z.object({
  enabled:       z.boolean().default(false),
  minimumScore:  z.number().min(0).max(100).default(70),
  maxTestFiles:  z.number().int().default(10),
  timeoutSec:    z.number().int().default(120),
  overrides:     z.array(MutationOverride).default([]),   // NEW: per-path thresholds
});

export const VisualTestingConfig = z.object({
  enabled:        z.boolean().default(false),
  pixelThreshold: z.number().min(0).max(1).default(0.02),
  maxDiffPercent: z.number().min(0).max(100).default(1.0),
  baselineDir:    z.string().default('visual-baselines'),
  viewports:      z.array(z.enum(['mobile','mobile_lg','tablet','desktop','widescreen'])).default(['mobile','tablet','desktop']),
});

export const LibraryDocsConfig = z.object({
  provider:  z.enum(['context7','disabled']).default('disabled'),
  maxTokens: z.number().int().default(2000),
});

export const OpenApiConfig = z.object({
  enabled:  z.boolean().default(false),
  specPath: z.string().optional(),
});

export const PerformanceConfig = z.object({
  enabled:             z.boolean().default(false),
  regressionThreshold: z.number().min(0).max(1).default(0.20),
  timeoutSec:          z.number().int().default(60),
});

export const LangfuseConfig = z.object({
  enabled:   z.boolean().default(false),
  publicKey: z.string().optional(),
  secretKey: z.string().optional(),
  baseUrl:   z.string().url().optional(),
});

// NEW: Incremental testing (opt-in, default: always run full suite)
export const IncrementalTestingConfig = z.object({
  enabled:            z.boolean().default(false),   // default OFF → safe
  fastFeedbackMode:   z.boolean().default(false),
});

// NEW: Expected sandbox environment (for drift detection)
export const SandboxEnvExpected = z.object({
  javaVersion:  z.string().optional(),  // e.g. "21"
  nodeVersion:  z.string().optional(),  // e.g. "20"
  mavenVersion: z.string().optional(),
  timezone:     z.string().optional(),  // e.g. "UTC"
}).optional();

// NEW: Feasibility check thresholds
export const FeasibilityConfig = z.object({
  enabled:            z.boolean().default(true),
  ambiguityThreshold: z.number().min(0).max(5).default(4),   // escalate if ambiguity >= this
  complexityThreshold: z.number().min(0).max(5).default(5),  // escalate if both high
  model:              z.string().default('claude-haiku-4-5-20251001'),  // cheap model
});

// NEW: Flakiness detection
export const FlakinessConfig = z.object({
  enabled:       z.boolean().default(true),
  runCount:      z.number().int().min(2).max(5).default(3),   // how many times to re-run suspect tests
  passThreshold: z.number().min(0).max(1).default(1.0),       // anything < 100% is flaky
});

// NEW: Test validity review (test-fault detection)
export const TestValidityConfig = z.object({
  enabled:              z.boolean().default(true),
  triggerAfterCycles:   z.number().int().default(2),   // cycles of same failure before triggering
  model:                z.string().default('claude-opus-4-6'),  // needs strong reasoning
});


// ── Redesign: new sub-configs ─────────────────────────────────────────────────

export const BaselineConfig = z.object({
  enabled:  z.boolean().default(true),
  failFast: z.boolean().default(true),   // escalate to HITL if baseline is broken
});

export const PlanningConfig = z.object({
  enabled:                 z.boolean().default(true),
  validateWithFastCritics: z.boolean().default(true),
  model:                   z.string().default('claude-haiku-4-5-20251001'),
});

export const GitCheckpointConfig = z.object({
  enabled:      z.boolean().default(false),   // opt-in; requires git in PATH
  branchPrefix: z.string().default('tacv/'),
  authorName:   z.string().default('TACV Bot'),
  authorEmail:  z.string().default('tacv@automated'),
});

export const CriticLanesConfig = z.object({
  alwaysRunSemantic:       z.boolean().default(false),
  semanticLaneDeferCycles: z.number().int().min(0).default(1),
});

export const HitlConfig = z.object({
  waitTimeout: z.string().default('48 hours'),
});

// ── Language-specific config ──────────────────────────────────────────────────

export const TypeScriptLanguageConfig = z.object({
  userSrcRoot: z.string().default('src'),
  debugPort:   z.number().int().default(9229),
});

export const JavaLanguageConfig = z.object({
  userPackage:     z.string().default('com.example'),
  debugPort:       z.number().int().default(5005),
  actuatorBaseUrl: z.string().default('http://localhost:8080/actuator'),
});

export const LanguageConfig = z.object({
  typescript: TypeScriptLanguageConfig.optional(),
  java:       JavaLanguageConfig.optional(),
}).default({});

export const WorkflowConfig = z.object({
  // Temporal
  temporalAddress:   z.string().default('localhost:7233'),
  temporalNamespace: z.string().default('default'),
  taskQueue:         z.string().default('tacv-main'),

  // Limits
  maxSelfCorrectionCycles:       z.number().int().min(1).default(6),
  maxReplanAttempts:             z.number().int().min(0).default(2),
  maxParallelBranches:           z.number().int().min(1).max(5).default(3),
  maxParallelCritics:            z.number().int().min(1).max(5).default(2),
  maxNodeTimeoutSec:             z.number().int().default(600),
  confidenceEscalationThreshold: z.number().min(0).max(1).default(0.4),
  enableMultiModelCritics:       z.boolean().default(false),
  frontendBaseUrl:               z.string().default('http://localhost:3000'),
  testTimeoutMs:                 z.number().int().default(120_000),
  repoPath:                      z.string().default('.'),
  agentModel:                    z.string().default('claude-opus-4-6'),
  agentsMdMaxChars:              z.number().int().default(4000),
  mem0VectorStore:               z.enum(['qdrant','chroma','pgvector','in-memory']).default('in-memory'),
  mem0Config:                    z.record(z.string(), z.unknown()).default({}),

  // Sub-configs
  tokenBudget:       TokenBudgetConfig.default({}),
  debug:             DebugConfig.default({}),
  stagnation:        StagnationConfig.default({}),
  shadowMode:        ShadowModeConfig.default({}),
  coverage:          CoverageConfig.default({}),
  mutation:          MutationConfig.default({}),
  visual:            VisualTestingConfig.default({}),
  libraryDocs:       LibraryDocsConfig.default({}),
  openApi:           OpenApiConfig.default({}),
  performance:       PerformanceConfig.default({}),
  langfuse:          LangfuseConfig.default({}),
  incrementalTesting: IncrementalTestingConfig.default({}),   // NEW
  sandboxEnvExpected: SandboxEnvExpected,                      // NEW
  feasibility:        FeasibilityConfig.default({}),           // NEW
  flakiness:          FlakinessConfig.default({}),             // NEW
  testValidity:       TestValidityConfig.default({}),          // NEW
  // Redesign sub-configs
  baseline:     BaselineConfig.default({}),
  planning:     PlanningConfig.default({}),
  gitCheckpoint: GitCheckpointConfig.default({}),
  criticLanes:  CriticLanesConfig.default({}),
  hitl:         HitlConfig.default({}),
  skipTddGate:  z.boolean().default(false),

  // Language-specific config
  languageConfig: LanguageConfig,
});
export type WorkflowConfig = z.infer<typeof WorkflowConfig>;

export function loadConfig(configPath?: string): WorkflowConfig {
  let raw: unknown = {};
  if (configPath) {
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch { /* use defaults */ }
  }
  const result = WorkflowConfig.safeParse(raw);
  if (!result.success) {
    const msgs = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msgs}`);
  }
  // Warn about non-default incremental testing
  if (result.data.incrementalTesting.enabled) {
    log.warn('config.incremental_testing_enabled', { hint: 'Full protection suite will NOT run on every cycle. Regressions outside the blast radius will be missed.' });
  }
  log.info('config.loaded', { taskQueue: result.data.taskQueue, model: result.data.agentModel });
  return result.data;
}
