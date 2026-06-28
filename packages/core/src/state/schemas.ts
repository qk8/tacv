import { z } from 'zod';

// ── Enums ─────────────────────────────────────────────────────────────────────
export const WorkflowPhase = z.enum([
  'BOOTSTRAP','SCOUT','FEASIBILITY_CHECK','VALUE_NODE','TDD_GATE','SANDBOX_VALIDATION',
  'ACTOR','PREFLIGHT','CRITICS','VERIFIER','FLAKINESS_CHECK','TEST_VALIDITY_REVIEW',
  'INTELLIGENT_DEBUGGER','REPLAN','SPECULATIVE_BRANCH','HITL_ESCALATION',
  'MEMORY_CONSOLIDATION','COMPLETE','FAILED',
]);
export type WorkflowPhase = z.infer<typeof WorkflowPhase>;
export const ALL_PHASES = WorkflowPhase.options;

export const ProjectMode     = z.enum(['GREENFIELD','BROWNFIELD']);
export type  ProjectMode     = z.infer<typeof ProjectMode>;
export const VerifierVerdict = z.enum(['PASS','FAIL','AMBIGUOUS']);
export type  VerifierVerdict = z.infer<typeof VerifierVerdict>;
export const DiagnosticVerdict = z.enum(['PASS','FIX_IMPL','FIX_TEST','AMBIGUOUS']);
export type  DiagnosticVerdict = z.infer<typeof DiagnosticVerdict>;
export const ErrorType = z.enum(['NULL_REFERENCE','CONCURRENT_MODIFICATION','OPTIMISTIC_LOCK','BEAN_CREATION_ERROR','VALIDATION_ERROR','ASYNC_RACE_CONDITION','ASYNC_PROMISE_UNHANDLED','REACT_STATE_MISMATCH','CLASS_CAST','STACK_OVERFLOW','OUT_OF_MEMORY','TIMEOUT','HTTP_400','LOGIC_ERROR','UNKNOWN']);
export type  ErrorType = z.infer<typeof ErrorType>;
export const ViewportName = z.enum(['mobile','mobile_lg','tablet','desktop','widescreen']);
export type  ViewportName = z.infer<typeof ViewportName>;

// ── Core domain ───────────────────────────────────────────────────────────────
export const TaskSpec = z.object({
  taskId: z.string().min(1), description: z.string().min(1),
  mode: ProjectMode, moduleType: z.string().min(1), languageIds: z.array(z.string()).min(1),
});
export type TaskSpec = z.infer<typeof TaskSpec>;

export const CorrectionCycle = z.object({
  attemptCount: z.number().int().min(0), branchName: z.string().nullable(),
  lastErrorHash: z.string().nullable(), errorHistory: z.array(z.string()),
  stagnationPattern: z.enum(['none','iteration','semantic','outcome']),
  lastOutcomeSignature: z.string().nullable(),
});
export type CorrectionCycle = z.infer<typeof CorrectionCycle>;

export const CriticFinding = z.object({
  critic: z.enum(['security','style','consistency','architecture','compatibility','test_preservation','dependency_vuln','performance','openapi_contract','requirement_trace','scope_creep']),
  severity: z.enum(['critical','warning','info']),
  file: z.string(), line: z.number().nullable(),
  ruleId: z.string(), message: z.string(), resolutionHint: z.string(),
});
export type CriticFinding = z.infer<typeof CriticFinding>;

export const BreakpointHit = z.object({
  file: z.string(), line: z.number(),
  variables: z.record(z.string(), z.object({ value: z.unknown(), type: z.string() })),
  callStack: z.array(z.string()), threadId: z.string(),
  extraEvals: z.record(z.string(), z.unknown()).optional(),
});
export type BreakpointHit = z.infer<typeof BreakpointHit>;

export const DebugObservations = z.object({
  errorType: ErrorType, rootCause: z.string(),
  breakpointHits: z.array(BreakpointHit),
  actuatorBeans: z.unknown().nullable(), actuatorEnv: z.unknown().nullable(),
  minimalPayload: z.record(z.string(), z.unknown()).nullable(),
  playwrightTracePath: z.string().nullable(),
  prunedStack: z.array(z.object({ file: z.string(), line: z.number(), method: z.string(), isUser: z.boolean() })),
});
export type DebugObservations = z.infer<typeof DebugObservations>;

export const AuditEntry = z.object({
  timestampMs: z.number(), node: z.string(), decision: z.string(),
  keyValues: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const LessonLearned = z.object({
  taskId: z.string(), sessionId: z.string(), taskDescription: z.string(),
  outcomeSummary: z.string(), keyDecisions: z.array(z.string()),
  commonMistakes: z.array(z.string()), archDecisions: z.array(z.string()),
  testsAdded: z.array(z.string()), correctionAttempts: z.number(),
  totalCostUsd: z.number(),
  succeededVia: z.enum(['direct','debugger','speculative','hitl']),
  qualityFlags: z.array(z.string()),
});
export type LessonLearned = z.infer<typeof LessonLearned>;

export const StrategyCandidate = z.object({
  strategyId: z.string(), description: z.string(), compositeScore: z.number(),
  estimatedRisk: z.enum(['low','medium','high']), affectedFiles: z.array(z.string()),
  avoidHint: z.string().optional(),
});
export type StrategyCandidate = z.infer<typeof StrategyCandidate>;

export const DiffEntry = z.object({
  filePath: z.string(), operation: z.enum(['create','modify','delete']),
  diffContent: z.string(), language: z.string(),
});
export type DiffEntry = z.infer<typeof DiffEntry>;

export const DiffProposal = z.object({
  diffs: z.array(DiffEntry), summary: z.string(), testFilePaths: z.array(z.string()),
});
export type DiffProposal = z.infer<typeof DiffProposal>;

export const VisualDiff = z.object({
  testName: z.string(), viewport: ViewportName,
  baselinePath: z.string(), actualPath: z.string(), diffPath: z.string().nullable(),
  pixelDiff: z.number(), pixelDiffPct: z.number(), passed: z.boolean(),
});
export type VisualDiff = z.infer<typeof VisualDiff>;

export const VisualTestResult = z.object({
  passed: z.boolean(), totalScreenshots: z.number(), failedScreenshots: z.number(),
  diffs: z.array(VisualDiff), baselineUpdated: z.boolean(),
});
export type VisualTestResult = z.infer<typeof VisualTestResult>;

export const MutationResult = z.object({
  mutationScore: z.number().min(0).max(100), totalMutants: z.number(),
  killedMutants: z.number(), survivedMutants: z.number(),
  weakTestFiles: z.array(z.string()), durationMs: z.number(),
});
export type MutationResult = z.infer<typeof MutationResult>;

export const ApiTestFailure = z.object({
  testName: z.string(), endpoint: z.string(), method: z.string(),
  expectedStatus: z.number(), actualStatus: z.number(), message: z.string(),
});
export type ApiTestFailure = z.infer<typeof ApiTestFailure>;

export const ApiTestResult = z.object({
  passed: z.boolean(), totalTests: z.number(), failedTests: z.number(),
  failures: z.array(ApiTestFailure), durationMs: z.number(),
});
export type ApiTestResult = z.infer<typeof ApiTestResult>;

export const SemanticChange = z.object({
  file: z.string(),
  kind: z.enum(['method_added','method_removed','method_signature_changed','field_added','field_removed','field_type_changed','class_added','class_removed','return_type_changed','visibility_changed','annotation_added','annotation_removed']),
  symbolName: z.string(), description: z.string(),
  breakingRisk: z.enum(['none','low','medium','high']),
});
export type SemanticChange = z.infer<typeof SemanticChange>;

export const AstDiffResult = z.object({
  semanticChanges: z.array(SemanticChange),
  breakingChangeCount: z.number(), safeChangeCount: z.number(),
});
export type AstDiffResult = z.infer<typeof AstDiffResult>;

export const TestFailure = z.object({
  testName: z.string().optional(), message: z.string(),
  file: z.string().optional(), line: z.number().nullable().optional(),
});
export type TestFailure = z.infer<typeof TestFailure>;

export const TestResult = z.object({
  passed: z.boolean(), totalTests: z.number(), failedTests: z.number(),
  failures: z.array(TestFailure),
  coverageReport: z.object({ lines: z.number(), branches: z.number(), functions: z.number(), statements: z.number() }).nullable(),
  durationMs: z.number(),
});
export type TestResult = z.infer<typeof TestResult>;

// ── Problem-fix schemas ───────────────────────────────────────────────────────

export const TestFaultAssessment = z.object({
  verdict: z.enum(['IMPLEMENTATION_FAULT','TEST_FAULT','AMBIGUOUS']),
  affectedTests: z.array(z.string()),
  proposedFixes: z.array(z.object({
    testFile: z.string(), currentAssertion: z.string(),
    suggestedFix: z.string(), justification: z.string(),
  })),
  confidence: z.number().min(0).max(1), reasoning: z.string(),
});
export type TestFaultAssessment = z.infer<typeof TestFaultAssessment>;

export const TestValidityFlag = z.object({
  suspected: z.boolean(), affectedTests: z.array(z.string()),
  proposedFixes: z.array(z.object({ testFile: z.string(), currentAssertion: z.string(), suggestedFix: z.string(), justification: z.string() })),
  confidence: z.number(), detectedAtCycle: z.number(),
}).nullable();
export type TestValidityFlag = z.infer<typeof TestValidityFlag>;

export const FlakinessReport = z.object({
  flakyTests: z.array(z.object({ testFile: z.string(), passRate: z.number(), runCount: z.number() })),
  detectedAt: z.number(),
}).nullable();
export type FlakinessReport = z.infer<typeof FlakinessReport>;

export const FeasibilityAssessment = z.object({
  ambiguity: z.number().min(0).max(5), complexity: z.number().min(0).max(5),
  risk: z.number().min(0).max(5), ambiguities: z.array(z.string()),
  shouldEscalateEarly: z.boolean(), escalationReason: z.string().nullable(),
});
export type FeasibilityAssessment = z.infer<typeof FeasibilityAssessment>;

export const ScopeViolation = z.object({ file: z.string(), reason: z.string() });
export type ScopeViolation = z.infer<typeof ScopeViolation>;

// ── Redesign additions ─────────────────────────────────────────────────────────

export const BaselineTestResult = z.object({
  passed:         z.boolean(),
  failureCount:   z.number().int().min(0),
  failures:       z.array(TestFailure),
  durationMs:     z.number(),
  ranAt:          z.number(),
  coverageReport: z.object({ lines: z.number(), branches: z.number(), functions: z.number(), statements: z.number() }).nullable(),
});
export type BaselineTestResult = z.infer<typeof BaselineTestResult>;

export const ImplementationPlan = z.object({
  planSummary:         z.string(),
  filesToCreate:       z.array(z.string()),
  filesToModify:       z.array(z.string()),
  filesToDelete:       z.array(z.string()),
  testFilesToCreate:   z.array(z.string()),
  estimatedComplexity: z.enum(['low', 'medium', 'high']),
  riskyAreas:          z.array(z.string()),
  criticsApproved:     z.boolean(),
  fastCriticFindings:  z.array(CriticFinding),
});
export type ImplementationPlan = z.infer<typeof ImplementationPlan>;

export const GitCheckpoint = z.object({
  commitHash:   z.string().nullable(),
  branch:       z.string(),
  checkpointAt: z.number(),
  changedFiles: z.array(z.string()),
  cycleNumber:  z.number().int(),
});
export type GitCheckpoint = z.infer<typeof GitCheckpoint>;

// ── Main WorkflowState (extended) ─────────────────────────────────────────────
export const WorkflowState = z.object({
  // Identity
  taskId: z.string(), sessionId: z.string(),
  task: TaskSpec, currentPhase: WorkflowPhase,
  workflowStartMs: z.number(),

  // Context
  contextSkeleton: z.unknown().nullable(), blastRadiusMap: z.unknown().nullable(),
  agentsMdContext: z.string().nullable(), gitBlameContext: z.string().nullable(),

  // Feasibility
  feasibility: FeasibilityAssessment.nullable(),
  sandboxEnvOk: z.boolean().nullable(),

  // Strategies
  strategyCandidates: z.array(StrategyCandidate), selectedStrategy: StrategyCandidate.nullable(),
  prunedStrategies: z.array(StrategyCandidate), exhaustedBranches: z.array(z.string()),
  activeBranches: z.array(z.string()),

  // Actor
  diffProposal: DiffProposal.nullable(),

  // Verification
  verifierVerdict: z.object({
    testResult: VerifierVerdict, diagnostic: DiagnosticVerdict,
    testFailures: z.array(TestFailure), blockedByCritic: z.boolean(),
    confidenceScore: z.number(),
  }).nullable(),

  // Problem-fix fields
  testValidityFlag: TestValidityFlag,
  flakinessReport: FlakinessReport,
  scopeViolations: z.array(ScopeViolation),
  hitlPriorGuidance: z.string().nullable(),
  hitlBudgetAtEscalation: z.number().nullable(),

  // Critics
  criticFindings: z.array(CriticFinding), criticErrors: z.array(z.string()),

  // Debugger
  debugObservations: DebugObservations.nullable(),

  // Testing extras
  visualTestResult: VisualTestResult.nullable(),
  mutationResult: MutationResult.nullable(),
  apiTestResult: ApiTestResult.nullable(),
  astDiff: AstDiffResult.nullable(),
  selectedTestFiles: z.array(z.string()),

  // Loop
  correctionCycle: CorrectionCycle,
  confidenceScore: z.number().min(0).max(1),
  cumulativeCostUsd: z.number().min(0),

  // Redesign: new state fields
  baselineTestResult:  BaselineTestResult.nullable(),
  implementationPlan:  ImplementationPlan.nullable(),
  gitCheckpoint:       GitCheckpoint.nullable(),
  sessionScratchpad:   z.string().nullable(),

  // Memory
  lessonLearned: LessonLearned.nullable(),
  escalationPayload: z.unknown().nullable(),
  workflowAuditTrail: z.array(AuditEntry),
});
export type WorkflowState = z.infer<typeof WorkflowState>;

// ── Factory & helpers ─────────────────────────────────────────────────────────
export function createInitialState(task: TaskSpec): WorkflowState {
  return WorkflowState.parse({
    taskId: task.taskId, sessionId: crypto.randomUUID(),
    task, currentPhase: 'BOOTSTRAP' as WorkflowPhase,
    workflowStartMs: Date.now(),
    contextSkeleton: null, blastRadiusMap: null, agentsMdContext: null, gitBlameContext: null,
    feasibility: null, sandboxEnvOk: null,
    strategyCandidates: [], selectedStrategy: null,
    prunedStrategies: [], exhaustedBranches: [], activeBranches: [],
    diffProposal: null, verifierVerdict: null,
    testValidityFlag: null, flakinessReport: null,
    scopeViolations: [], hitlPriorGuidance: null, hitlBudgetAtEscalation: null,
    criticFindings: [], criticErrors: [],
    debugObservations: null, visualTestResult: null,
    mutationResult: null, apiTestResult: null, astDiff: null, selectedTestFiles: [],
    correctionCycle: { attemptCount: 0, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none', lastOutcomeSignature: null },
    confidenceScore: 1.0, cumulativeCostUsd: 0.0,
    lessonLearned: null, escalationPayload: null, workflowAuditTrail: [],
    baselineTestResult: null, implementationPlan: null,
    gitCheckpoint: null, sessionScratchpad: null,
  });
}

export const withPhase  = (s: WorkflowState, p: WorkflowPhase): WorkflowState => ({ ...s, currentPhase: p });
export const withCost   = (s: WorkflowState, c: number):        WorkflowState => ({ ...s, cumulativeCostUsd: c });
export const withAuditEntry = (s: WorkflowState, e: Omit<AuditEntry,'timestampMs'>): WorkflowState => ({
  ...s, workflowAuditTrail: [...s.workflowAuditTrail, { ...e, timestampMs: Date.now() }].slice(-100),
});
export const nextAttempt = (c: CorrectionCycle, branch: string, hash: string|null=null): CorrectionCycle => ({
  ...c, attemptCount: c.attemptCount + 1, branchName: branch, lastErrorHash: hash,
});
