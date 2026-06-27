import { z } from 'zod';
import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import type { WorkflowConfig } from '../../config/index.js';
import { createLogger } from '../../observability/logger.js';
import { testPreservationCritic } from './testPreservationCritic.js';
import { securityCritic }        from './securityCritic.js';
import { styleCritic }           from './styleCritic.js';
import { consistencyCritic }     from './consistencyCritic.js';
import { compatibilityCritic }   from './compatibilityCritic.js';
import { architectureCritic }    from './architectureCritic.js';
import { dependencyCritic }      from './dependencyCritic.js';
import { performanceCritic }     from './performanceCritic.js';
import { openApiCritic }         from './openApiCritic.js';
import { requirementTraceCritic } from './requirementTraceCritic.js';
import { scopeCreepCritic }      from './scopeCreepCritic.js';

export { requirementTraceCritic, scopeCreepCritic };

const log = createLogger('tacv.critics');

export type CriticLane = 'fast' | 'semantic';
export type CriticFn   = (state: WorkflowState, deps: ActivityDeps) => Promise<CriticFinding[]>;

export interface CriticDef {
  name: string;
  lane: CriticLane;
  fn:   CriticFn;
}

/**
 * Returns all applicable critics for the given state, tagged with their lane.
 *
 * Fast lane  — static analysis, regex, plugin APIs. No LLM cost. Always run.
 * Semantic lane — LLM-based critics (extractor.extract). Deferred by default
 *                 until cycle >= criticLanes.semanticLaneDeferCycles.
 */
export function getCriticDefs(state: WorkflowState, config?: WorkflowConfig): CriticDef[] {
  const defs: CriticDef[] = [
    // ── Fast lane: static analysis, no LLM ──────────────────────────────────
    { name: 'security',          lane: 'fast', fn: securityCritic },
    { name: 'style',             lane: 'fast', fn: styleCritic },
    { name: 'consistency',       lane: 'fast', fn: consistencyCritic },
    { name: 'test_preservation', lane: 'fast', fn: testPreservationCritic },
    { name: 'dependency_vuln',   lane: 'fast', fn: dependencyCritic },
    // ── Semantic lane: LLM-based ─────────────────────────────────────────────
    { name: 'requirement_trace', lane: 'semantic', fn: requirementTraceCritic },
  ];

  if (state.task.mode === 'GREENFIELD') {
    defs.push({ name: 'architecture', lane: 'fast',     fn: architectureCritic });
  }
  if (state.task.mode === 'BROWNFIELD') {
    defs.push({ name: 'compatibility', lane: 'fast',     fn: compatibilityCritic });
    defs.push({ name: 'scope_creep',   lane: 'semantic', fn: scopeCreepCritic });
  }
  if (config?.openApi.enabled) {
    defs.push({ name: 'openapi_contract', lane: 'semantic', fn: openApiCritic });
  }
  if (config?.performance.enabled) {
    defs.push({ name: 'performance', lane: 'fast', fn: performanceCritic });
  }
  return defs;
}

/**
 * Returns critics split into fast and semantic lanes.
 *
 * Improvement over TACV original: previously all 11 critics ran in parallel
 * regardless of LLM cost. Now:
 *   - fast lane: static analysis, no LLM, runs every cycle
 *   - semantic lane: LLM-based, deferred until cycle >= deferCycles (default: 1)
 *
 * This saves ~$0.10/cycle on early correction cycles where the code doesn't
 * even compile yet — no point asking an LLM for architectural critique of
 * broken TypeScript.
 */
export function getCriticLanes(
  state:  WorkflowState,
  config: WorkflowConfig,
): { fastLane: CriticDef[]; semanticLane: CriticDef[] } {
  const all          = getCriticDefs(state, config);
  const fastLane     = all.filter(c => c.lane === 'fast');
  const semanticLane = all.filter(c => c.lane === 'semantic');
  return { fastLane, semanticLane };
}

const ValidatedFindings = z.array(z.object({
  critic: z.string(), severity: z.string(), file: z.string(),
  line: z.number().nullable(), ruleId: z.string(), message: z.string(), resolutionHint: z.string(),
}));

async function validateFindingsWithSecondModel(
  findings: CriticFinding[],
  state:    WorkflowState,
  deps:     ActivityDeps,
): Promise<CriticFinding[]> {
  if (findings.length === 0) return [];
  log.info('critics.multi_model_validation', { original: findings.length });
  try {
    const diffSummary = state.diffProposal?.diffs
      .map(d => `${d.filePath}:\n${d.diffContent.slice(0, 300)}`)
      .join('\n---\n') ?? '';
    const validated = await deps.extractor.extract(
      `Review these code review findings. Return ONLY the ones that are genuinely valid for this code change. Dismiss false positives, minor style nitpicks unrelated to real problems, and findings that don't apply to the actual diff.\n\nFindings: ${JSON.stringify(findings.slice(0, 20))}\nCode diff: ${diffSummary.slice(0, 1500)}`,
      ValidatedFindings,
      { system: 'You are a senior engineer validating code review findings. Be strict about false positives.', model: 'claude-haiku-4-5-20251001' },
    );
    const cast = validated as unknown as CriticFinding[];
    log.info('critics.multi_model_result', { original: findings.length, validated: cast.length });
    return cast;
  } catch (err) {
    log.warn('critics.multi_model_failed', { error: String(err) });
    return findings;
  }
}

async function runCriticSet(
  defs:  CriticDef[],
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<{ findings: CriticFinding[]; errors: string[] }> {
  const results = await Promise.allSettled(defs.map(d => d.fn(state, deps)));
  const findings: CriticFinding[] = [];
  const errors:   string[]        = [];

  for (const [i, result] of results.entries()) {
    const def = defs[i]!;
    if (result.status === 'fulfilled') {
      findings.push(...result.value);
    } else {
      deps.log.error('critic.exception', {
        critic:    def.name,
        lane:      def.lane,
        error:     result.reason instanceof Error ? result.reason.message    : String(result.reason),
        errorType: result.reason instanceof Error ? result.reason.constructor.name : 'Unknown',
        stack:     result.reason instanceof Error ? result.reason.stack      : undefined,
      });
      errors.push(def.name);
    }
  }
  return { findings, errors };
}

/**
 * Runs critics with lane-aware execution.
 *
 * @param lane
 *   'fast'     — only static/no-LLM critics
 *   'semantic' — only LLM-based critics
 *   'all'      — both lanes, with deferred-cycle logic applied
 */
export async function allCriticsImpl(
  state: WorkflowState,
  deps:  ActivityDeps,
  lane:  'fast' | 'semantic' | 'all' = 'all',
): Promise<WorkflowState> {
  if (!state.diffProposal) return { ...state, currentPhase: 'VERIFIER' };

  const { fastLane, semanticLane } = getCriticLanes(state, deps.config);
  const cycle                      = state.correctionCycle.attemptCount;
  const { alwaysRunSemantic, semanticLaneDeferCycles } = deps.config.criticLanes;

  // Determine which critics to run based on lane parameter and defer config
  let defsToRun: CriticDef[] = [];
  if (lane === 'fast') {
    defsToRun = fastLane;
  } else if (lane === 'semantic') {
    defsToRun = semanticLane;
  } else {
    // lane === 'all': apply deferral config
    const runSemantic = alwaysRunSemantic || (cycle >= semanticLaneDeferCycles);
    defsToRun = runSemantic ? [...fastLane, ...semanticLane] : fastLane;
    if (!runSemantic) {
      log.info('critics.semantic_deferred', { cycle, deferUntil: semanticLaneDeferCycles });
    }
  }

  log.info('critics.start', {
    critics: defsToRun.map(c => c.name),
    lane,
    mode: state.task.mode,
    cycle,
  });

  const { findings: rawFindings, errors: criticErrors } = await runCriticSet(defsToRun, state, deps);

  const allFindings = deps.config.enableMultiModelCritics && rawFindings.length > 0
    ? await validateFindingsWithSecondModel(rawFindings, state, deps)
    : rawFindings;

  const scopeViolations = allFindings
    .filter(f => f.ruleId === 'OUT_OF_SCOPE_CHANGE')
    .map(f => ({ file: f.file, reason: f.message }));

  const blockedByCritic = allFindings.some(f => f.severity === 'critical');

  log.info('critics.complete', {
    total:    allFindings.length,
    critical: allFindings.filter(f => f.severity === 'critical').length,
    errors:   criticErrors.length,
    lane,
  });

  return {
    ...state,
    currentPhase:   'VERIFIER',
    criticFindings: allFindings,
    criticErrors,
    scopeViolations,
    verifierVerdict: blockedByCritic ? {
      testResult:      'FAIL',
      diagnostic:      'FIX_IMPL',
      testFailures:    allFindings.filter(f => f.severity === 'critical').map(f => ({ testName: f.ruleId, message: `[${f.critic}] ${f.message}` })),
      blockedByCritic: true,
      confidenceScore: state.confidenceScore,
    } : state.verifierVerdict,
    workflowAuditTrail: [...state.workflowAuditTrail, {
      timestampMs: Date.now(), node: 'critics',
      decision:   blockedByCritic ? 'blocked_by_critic' : 'critics_passed',
      keyValues:  { total: allFindings.length, critical: allFindings.filter(f => f.severity === 'critical').length, lane },
    }],
  };
}
