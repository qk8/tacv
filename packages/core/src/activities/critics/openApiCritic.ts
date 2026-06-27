import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { isControllerFile } from './shared.js';
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.critics.openapi');

const OpenApiViolation = z.object({
  file:            z.string(),
  violation:       z.string(),
  resolutionHint:  z.string(),
});
const ViolationsArray = z.array(OpenApiViolation);

export async function openApiCritic(
  state: WorkflowState,
  deps:  ActivityDeps,
): Promise<CriticFinding[]> {
  if (!state.diffProposal || !deps.config.openApi.enabled) return [];

  // Find OpenAPI spec
  const specPath = deps.config.openApi.specPath
    ?? await findOpenApiSpec(deps.repoPath);
  if (!specPath) return [];

  const langId = state.task.languageIds[0] ?? 'typescript';
  const plugin = deps.pluginRegistry.get(langId);
  const controllerDiffs = state.diffProposal.diffs.filter(d =>
    isControllerFile(d.filePath, plugin),
  );
  if (controllerDiffs.length === 0) return [];

  let specContent = '';
  try {
    specContent = (await fs.readFile(specPath, 'utf8')).slice(0, 3000);
  } catch { return []; }

  const diffSnippet = controllerDiffs
    .map(d => `${d.filePath}:\n${d.diffContent.slice(0, 500)}`)
    .join('\n---\n');

  try {
    const violations = await deps.extractor.extract(
      `OpenAPI spec (excerpt):\n${specContent}\n\nController changes:\n${diffSnippet}\n\nIdentify ONLY genuine API contract violations: removed endpoints, changed response shapes, new required fields without defaults, changed status codes. Ignore additive, backward-compatible changes.`,
      ViolationsArray,
      { system: 'You are an API contract validator. Only report genuine breaking changes. Return [] if none.', model: 'claude-haiku-4-5-20251001' },
    );

    return violations.map(v => ({
      critic:         'openapi_contract' as const,
      severity:       'critical' as const,
      file:           v.file,
      line:           null,
      ruleId:         'OPENAPI_CONTRACT_VIOLATION',
      message:        v.violation,
      resolutionHint: v.resolutionHint,
    }));
  } catch (err) {
    log.warn('openapi_critic.extract_failed', { error: String(err) });
    return [];
  }
}

async function findOpenApiSpec(repoPath: string): Promise<string | null> {
  const candidates = [
    'openapi.yaml', 'openapi.yml', 'openapi.json',
    'api-docs.yaml', 'api-docs.yml', 'swagger.yaml', 'swagger.json',
    'src/main/resources/openapi.yaml',
    'docs/openapi.yaml',
  ];
  for (const c of candidates) {
    try { await fs.access(path.join(repoPath, c)); return path.join(repoPath, c); } catch { /* try next */ }
  }
  return null;
}
