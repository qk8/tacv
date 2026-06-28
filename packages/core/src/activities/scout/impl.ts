import type { WorkflowState, StrategyCandidate } from '../../state/schemas.js';
import { withAuditEntry } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';
import { z } from 'zod';

const log = createLogger('tacv.scout');

const ScoutOutput = z.object({
  contextSkeleton:     z.unknown(),
  strategyCandidates:  z.array(z.object({
    strategyId:     z.string(),
    description:    z.string(),
    compositeScore: z.number(),
    estimatedRisk:  z.enum(['low','medium','high']),
    affectedFiles:  z.array(z.string()),
  })),
  gitBlameContext: z.string().nullable(),
});

export async function scoutImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  log.info('scout.start', { taskId: state.taskId, mode: state.task.mode });

  // Compute blast radius for brownfield
  let blastRadiusMap: unknown = null;
  if (state.task.mode === 'BROWNFIELD') {
    try {
      const allFiles = await deps.codeGraph.getDependencySubgraph([]);
      blastRadiusMap = allFiles;
    } catch (err) {
      log.warn('scout.blast_radius_failed', { error: String(err) });
    }
  }

  // Resolve library docs
  let libraryDocsContext = '';
  if (deps.libraryDocs.isEnabled()) {
    try {
      const deps_ = await detectDependencies(deps.repoPath);
      const docs   = await deps.libraryDocs.resolve(deps_);
      libraryDocsContext = docs.libraries
        .map(l => `## ${l.library} ${l.version}\n${l.summary}\n${l.apiNotes}`)
        .join('\n\n');
    } catch (err) {
      log.warn('scout.library_docs_failed', { error: String(err) });
    }
  }

  // Fetch relevant memory
  let memoryContext = '';
  try {
    const memories = await deps.memory.search({
      userId: 'global', agentId: 'tacv-agent',
      text:   state.task.description, topK: 5,
      filters: { type: 'episodic', subtype: 'lesson_learned' },
    });
    if (memories.length > 0) {
      memoryContext = '## Prior lessons:\n' + memories.map(m => `- ${m.text.slice(0,200)}`).join('\n');
    }
  } catch (err) {
    log.warn('scout.memory_search_failed', { error: String(err) });
  }

  const scoutPrompt = buildScoutPrompt(state, libraryDocsContext, memoryContext);

  const output = await deps.extractor.extract(scoutPrompt, ScoutOutput, {
    system: 'You are a senior software architect analyzing a codebase to plan an implementation.',
    model:  deps.config.agentModel,
  });

  const candidates: StrategyCandidate[] = output.strategyCandidates;

  log.info('scout.complete', { strategies: candidates.length, taskId: state.taskId });

  return withAuditEntry({
    ...state,
    currentPhase:       'VALUE_NODE',
    contextSkeleton:    output.contextSkeleton,
    blastRadiusMap,
    gitBlameContext:    output.gitBlameContext,
    strategyCandidates: candidates,
  }, { node: 'scout', decision: 'context_built', keyValues: { strategies: candidates.length } });
}

function buildScoutPrompt(state: WorkflowState, libraryDocs: string, memory: string): string {
  return `
Task: ${state.task.description}
Mode: ${state.task.mode}
Module Type: ${state.task.moduleType}
Languages: ${state.task.languageIds.join(', ')}

${state.agentsMdContext ? `## Project Conventions (AGENTS.md):\n${state.agentsMdContext}` : ''}
${libraryDocs ? `\n## Library Documentation:\n${libraryDocs}` : ''}
${memory ? `\n${memory}` : ''}

Analyze this task and return:
1. A contextSkeleton object with the key code areas involved
2. 3 strategyCandidates ranked by compositeScore (0-1) with estimated risk
3. gitBlameContext if relevant

Return a JSON object matching the ScoutOutput schema.
`.trim();
}

export async function detectDependencies(repoPath: string): Promise<Array<{ name: string; version: string; ecosystem: 'npm' | 'maven' | 'gradle' | 'pip' }>> {
  const deps: Array<{ name: string; version: string; ecosystem: 'npm' | 'maven' | 'gradle' | 'pip' }> = [];
  const { readFile } = await import('node:fs/promises');

  // ── NPM ────────────────────────────────────────────────────────────────────
  try {
    const pkg = JSON.parse(await readFile(`${repoPath}/package.json`, 'utf8')) as Record<string, unknown>;
    const allDeps = { ...pkg['dependencies'] as Record<string,string>, ...pkg['devDependencies'] as Record<string,string> };
    for (const [name, version] of Object.entries(allDeps)) {
      deps.push({ name, version: String(version), ecosystem: 'npm' });
    }
  } catch { /* not a Node project */ }

  // ── Maven ──────────────────────────────────────────────────────────────────
  try {
    const pom = await readFile(`${repoPath}/pom.xml`, 'utf8');
    const depMatches = pom.matchAll(/<dependency>(?:[^<]|<!--[\s\S]*?-->)*<groupId>([^<]+)<\/groupId>(?:[^<]|<!--[\s\S]*?-->)*<artifactId>([^<]+)<\/artifactId>(?:[^<]|<!--[\s\S]*?-->)*(?:<version>([^<]+)<\/version>)?(?:[^<]|<!--[\s\S]*?-->)*<\/dependency>/g);
    for (const m of depMatches) {
      if (m[2]) deps.push({ name: `${m[1]}:${m[2]}`, version: m[3] ?? 'managed', ecosystem: 'maven' });
    }
  } catch { /* not a Maven project */ }

  // ── Gradle (build.gradle) ─────────────────────────────────────────────────
  try {
    const gradle = await readFile(`${repoPath}/build.gradle`, 'utf8');
    const depMatches = gradle.matchAll(/(?:implementation|api|compileOnly|runtimeOnly)\s+'([^']+)'/g);
    for (const m of depMatches) {
      const parts = m[1].split(':');
      if (parts.length >= 3) {
        deps.push({ name: `${parts[0]}:${parts[1]}`, version: parts[2], ecosystem: 'gradle' });
      }
    }
  } catch { /* not a Gradle project */ }

  // ── Pip (requirements.txt) ────────────────────────────────────────────────
  try {
    const lines = (await readFile(`${repoPath}/requirements.txt`, 'utf8')).split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [name, ...rest] = trimmed.split('==');
      if (name) deps.push({ name: name.trim(), version: rest.join('==').trim() || 'latest', ecosystem: 'pip' });
    }
  } catch { /* not a Python project */ }

  return deps.slice(0, 20);
}
