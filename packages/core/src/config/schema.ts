import { z } from 'zod';

export const TokenBudgetConfig = z.object({
  criticalDollar:  z.number().positive().default(80),
  warningDollar:   z.number().positive().default(50),
  costPerMInput:   z.number().positive().default(5),
  costPerMOutput:  z.number().positive().default(30),
});
export type TokenBudgetConfig = z.infer<typeof TokenBudgetConfig>;

export const DebugConfig = z.object({
  userJavaPackage:  z.string().default('com.example'),
  userTsSrcRoot:    z.string().default('src'),
  jdwpPort:         z.number().int().default(5005),
  cdpPort:          z.number().int().default(9229),
  debugTimeoutSec:  z.number().int().default(30),
  debugPortWaitSec: z.number().default(30),
  maxDebugSteps:    z.number().int().default(10),
  actuatorBaseUrl:  z.string().default('http://localhost:8080/actuator'),
});
export type DebugConfig = z.infer<typeof DebugConfig>;

export const StagnationConfig = z.object({
  totalAbortForce:             z.number().int().default(3),
  driftRevisionLimit:          z.number().int().default(2),
  semanticSimilarityThreshold: z.number().min(0).max(1).default(0.85),
});
export type StagnationConfig = z.infer<typeof StagnationConfig>;

export const ShadowModeConfig = z.object({
  enabled:        z.boolean().default(false),
  cronSchedule:   z.string().default('0 2 * * *'),
  maxTasksPerRun: z.number().int().default(3),
});
export type ShadowModeConfig = z.infer<typeof ShadowModeConfig>;

export const CoverageConfig = z.object({
  minimumLineCoverage:         z.number().min(0).max(100).default(80),
  maxLineCoverageRegression:   z.number().min(0).max(10).default(2),
  maxBranchCoverageRegression: z.number().min(0).max(10).default(2),
});
export type CoverageConfig = z.infer<typeof CoverageConfig>;

export const MutationConfig = z.object({
  enabled:      z.boolean().default(false),
  minimumScore: z.number().min(0).max(100).default(70),
  maxTestFiles: z.number().int().default(10),
  timeoutSec:   z.number().int().default(120),
});
export type MutationConfig = z.infer<typeof MutationConfig>;

export const VisualTestingConfig = z.object({
  enabled:       z.boolean().default(false),
  pixelThreshold: z.number().min(0).max(1).default(0.02),
  maxDiffPercent: z.number().min(0).max(100).default(1.0),
  baselineDir:   z.string().default('visual-baselines'),
  viewports:     z.array(
    z.enum(['mobile', 'mobile_lg', 'tablet', 'desktop', 'widescreen'])
  ).default(['mobile', 'tablet', 'desktop']),
});
export type VisualTestingConfig = z.infer<typeof VisualTestingConfig>;

export const LibraryDocsConfig = z.object({
  provider:  z.enum(['context7', 'disabled']).default('disabled'),
  maxTokens: z.number().int().default(2000),
});
export type LibraryDocsConfig = z.infer<typeof LibraryDocsConfig>;

export const OpenApiConfig = z.object({
  enabled:  z.boolean().default(false),
  specPath: z.string().optional(),
});
export type OpenApiConfig = z.infer<typeof OpenApiConfig>;

export const PerformanceConfig = z.object({
  enabled:             z.boolean().default(false),
  regressionThreshold: z.number().min(0).max(1).default(0.20),
  timeoutSec:          z.number().int().default(60),
});
export type PerformanceConfig = z.infer<typeof PerformanceConfig>;

export const LangfuseConfig = z.object({
  enabled:   z.boolean().default(false),
  publicKey: z.string().optional(),
  secretKey: z.string().optional(),
  baseUrl:   z.string().url().optional(),
});
export type LangfuseConfig = z.infer<typeof LangfuseConfig>;

export const WorkflowConfig = z.object({
  temporalAddress:   z.string().default('localhost:7233'),
  temporalNamespace: z.string().default('default'),
  taskQueue:         z.string().default('tacv-main'),

  maxSelfCorrectionCycles:       z.number().int().min(1).default(6),
  maxReplanAttempts:             z.number().int().min(0).default(2),
  maxParallelBranches:           z.number().int().min(1).max(5).default(3),
  maxParallelCritics:            z.number().int().min(1).max(5).default(2),
  maxNodeTimeoutSec:             z.number().int().default(600),

  confidenceEscalationThreshold: z.number().min(0).max(1).default(0.4),

  tokenBudget:   TokenBudgetConfig.default({}),
  debug:         DebugConfig.default({}),
  stagnation:    StagnationConfig.default({}),
  shadowMode:    ShadowModeConfig.default({}),
  coverage:      CoverageConfig.default({}),
  mutation:      MutationConfig.default({}),
  visual:        VisualTestingConfig.default({}),
  libraryDocs:   LibraryDocsConfig.default({}),
  openApi:       OpenApiConfig.default({}),
  performance:   PerformanceConfig.default({}),
  langfuse:      LangfuseConfig.default({}),

  repoPath:                z.string().default('.'),
  agentsMdMaxChars:        z.number().int().default(4000),
  agentModel:              z.string().default('claude-opus-4-6'),
  mem0VectorStore:         z.enum(['qdrant', 'chroma', 'pgvector', 'in-memory']).default('in-memory'),
  mem0Config:              z.record(z.string(), z.unknown()).default({}),
  frontendBaseUrl:         z.string().default('http://localhost:3000'),
  testTimeoutMs:           z.number().int().default(120_000),
  enableMultiModelCritics: z.boolean().default(false),
  skipTddGate:             z.boolean().default(false),
});
export type WorkflowConfig = z.infer<typeof WorkflowConfig>;

export function loadConfig(raw: unknown = {}): WorkflowConfig {
  const result = WorkflowConfig.safeParse(raw);
  if (!result.success) {
    throw new Error(
      'Invalid TACV configuration:\n' +
      result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  return result.data;
}
