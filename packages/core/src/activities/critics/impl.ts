import { z } from 'zod';
import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
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

export type CriticFn = (state: WorkflowState, deps: ActivityDeps) => Promise<CriticFinding[]>;
export interface CriticDef { name: string; fn: CriticFn }

export function getCriticDefs(state: WorkflowState, config?: ActivityDeps['config']): CriticDef[] {
  const defs: CriticDef[] = [
    { name: 'security',           fn: securityCritic },
    { name: 'style',              fn: styleCritic },
    { name: 'consistency',        fn: consistencyCritic },
    { name: 'test_preservation',  fn: testPreservationCritic },
    { name: 'dependency_vuln',    fn: dependencyCritic },
    { name: 'requirement_trace',  fn: requirementTraceCritic },  // NEW
  ];
  if (state.task.mode === 'GREENFIELD') defs.push({ name: 'architecture',      fn: architectureCritic });
  if (state.task.mode === 'BROWNFIELD') defs.push({ name: 'compatibility',     fn: compatibilityCritic });
  if (state.task.mode === 'BROWNFIELD') defs.push({ name: 'scope_creep',       fn: scopeCreepCritic });    // NEW
  if (config?.openApi.enabled)          defs.push({ name: 'openapi_contract',  fn: openApiCritic });
  if (config?.performance.enabled)      defs.push({ name: 'performance',       fn: performanceCritic });
  return defs;
}

const ValidatedFindings = z.array(z.object({
  critic: z.string(), severity: z.string(), file: z.string(),
  line: z.number().nullable(), ruleId: z.string(), message: z.string(), resolutionHint: z.string(),
}));

async function validateFindingsWithSecondModel(findings: CriticFinding[], state: WorkflowState, deps: ActivityDeps): Promise<CriticFinding[]> {
  if (findings.length === 0) return [];
  log.info('critics.multi_model_validation', { original: findings.length });
  try {
    const diffSummary = state.diffProposal?.diffs.map(d => `${d.filePath}:\n${d.diffContent.slice(0, 300)}`).join('\n---\n') ?? '';
    const validated = await deps.extractor.extract(
      `Review these code review findings. Return ONLY the ones that are genuinely valid for this code change. Dismiss false positives, minor style nitpicks unrelated to real problems, and findings that don't apply to the actual diff.
       
       Findings: ${JSON.stringify(findings.slice(0, 20))}
       Code diff: ${diffSummary.slice(0, 1500)}`,
      ValidatedFindings,
      { system: 'You are a senior engineer validating code review findings. Be strict about false positives.', model: 'claude-haiku-4-5-20251001' },
    );
    const cast = validated as unknown as CriticFinding[];
    log.info('critics.multi_model_result', { original: findings.length, validated: cast.length, dismissed: findings.length - cast.length });
    return cast;
  } catch (err) {
    log.warn('critics.multi_model_failed', { error: String(err) });
    return findings;
  }
}

export async function allCriticsImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  if (!state.diffProposal) return { ...state, currentPhase: 'VERIFIER' };

  const defs = getCriticDefs(state, deps.config);
  log.info('critics.start', { critics: defs.map(c => c.name), mode: state.task.mode });

  const results = await Promise.allSettled(defs.map(d => d.fn(state, deps)));
  const rawFindings: CriticFinding[] = [];
  const criticErrors: string[] = [];

  for (const [i, result] of results.entries()) {
    const def = defs[i]!;
    if (result.status === 'fulfilled') rawFindings.push(...result.value);
    else {
      deps.log.error('critic.exception', {
        critic: def.name,
        error:  result.reason instanceof Error ? result.reason.message    : String(result.reason),
        errorType: result.reason instanceof Error ? result.reason.constructor.name : 'Unknown',
        stack:  result.reason instanceof Error ? result.reason.stack      : undefined,
      });
      criticErrors.push(def.name);
    }
  }

  const allFindings = deps.config.enableMultiModelCritics && rawFindings.length > 0
    ? await validateFindingsWithSecondModel(rawFindings, state, deps)
    : rawFindings;

  // Collect scope violations separately for the Actor context
  const scopeViolations = allFindings
    .filter(f => f.ruleId === 'OUT_OF_SCOPE_CHANGE')
    .map(f => ({ file: f.file, reason: f.message }));

  const blockedByCritic = allFindings.some(f => f.severity === 'critical');
  log.info('critics.complete', { total: allFindings.length, critical: allFindings.filter(f => f.severity === 'critical').length, errors: criticErrors.length });

  return {
    ...state,
    currentPhase:    'VERIFIER',
    criticFindings:  allFindings,
    criticErrors,
    scopeViolations,
    verifierVerdict: blockedByCritic ? {
      testResult: 'FAIL', diagnostic: 'FIX_IMPL',
      testFailures: allFindings.filter(f => f.severity === 'critical').map(f => ({ testName: f.ruleId, message: `[${f.critic}] ${f.message}` })),
      blockedByCritic: true, confidenceScore: state.confidenceScore,
    } : state.verifierVerdict,
    workflowAuditTrail: [...state.workflowAuditTrail, {
      timestampMs: Date.now(), node: 'critics',
      decision: blockedByCritic ? 'blocked_by_critic' : 'critics_passed',
      keyValues: { total: allFindings.length, critical: allFindings.filter(f=>f.severity==='critical').length },
    }],
  };
}
