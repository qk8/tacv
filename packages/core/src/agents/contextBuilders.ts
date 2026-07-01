/**
 * Agent-team context builders.
 *
 * ── Problem this replaces ───────────────────────────────────────────────────
 * `actorImpl` builds one prompt that is expected to carry repository
 * understanding, prior-attempt history, scope constraints, test obligations,
 * and implementation instructions all at once, for whatever the agent
 * decides to touch this cycle. Even `buildCompressedActorPrompt` — the
 * already-compressed variant — dumps the FULL implementation-plan file list
 * (including files this node has nothing to do with), the full session
 * scratchpad tail, and `agentsMdContext` sliced by character count rather
 * than by relevance (a TypeScript node still receives Java conventions if
 * they happen to fall within the first N characters).
 *
 * ── What this module provides ───────────────────────────────────────────────
 * Two role-scoped, single-DAG-node prompt builders:
 *   - Test Writer: writes only test files for one node, in AAA style,
 *     forbidden from touching implementation code.
 *   - Implementor: receives the test file(s) the Test Writer already
 *     produced for this node and must satisfy them, plus only the critic
 *     findings and project conventions actually relevant to this node's
 *     files/language — not the whole workflow's accumulated noise.
 * `filterConventionsByLanguage` is the key narrowing primitive: it drops
 * AGENTS.md sections that are clearly about a different language than the
 * current task, rather than truncating by character count.
 */

import type { WorkflowState, DiffEntry } from '../state/schemas.js';
import type { TaskNode } from '../planning/graph.js';

const KNOWN_LANGUAGE_HEADING_HINTS = ['java', 'python', 'go', 'rust', 'c#', 'ruby', 'kotlin', 'php'];

/**
 * Splits AGENTS.md-style markdown on `## ` headings and drops sections whose
 * heading clearly names a language the current task does not use. Sections
 * with no recognizable language hint in the heading (generic conventions,
 * testing patterns, architecture rules) are always kept.
 */
export function filterConventionsByLanguage(agentsMdContext: string | null, languageIds: string[]): string {
  if (!agentsMdContext) return '';
  const taskLangs = languageIds.map(l => l.toLowerCase());
  const sections = agentsMdContext.split(/(?=^## )/m);
  const kept = sections.filter(section => {
    const heading = section.match(/^##\s*(.+)$/m)?.[1]?.toLowerCase();
    if (!heading) return true;
    const namesOtherLanguage = KNOWN_LANGUAGE_HEADING_HINTS.some(
      hint => heading.includes(hint) && !taskLangs.includes(hint),
    );
    return !namesOtherLanguage;
  });
  return kept.join('').trim();
}

export function buildTestWriterSystemPrompt(): string {
  return `
You are a Test Writer agent — one role within a multi-agent coding team.
Your ONLY job is to write test files for the single subtask you are given,
using the Arrange-Act-Assert (AAA) pattern and this project's existing test
conventions and framework.

Do NOT write or modify any implementation code. Do not implement the feature.
Test files only — your tests are the executable specification an Implementor
agent will satisfy afterward.

Output a JSON code block:
\`\`\`json
{"diffs":[{"filePath":"...","operation":"create","diffContent":"...","language":"..."}],"summary":"..."}
\`\`\``.trim();
}

export function buildTestWriterUserPrompt(node: TaskNode, state: WorkflowState): string {
  const parts: string[] = [
    `## Subtask (write tests only)\n${node.description}`,
    `## Target file(s)\n${node.filesToTouch.join(', ')}`,
  ];
  const conventions = filterConventionsByLanguage(state.agentsMdContext, state.task.languageIds);
  if (conventions) parts.push(`## Project Conventions\n${conventions}`);
  return parts.join('\n\n');
}

export function buildImplementorSystemPrompt(): string {
  return `
You are an Implementor agent — one role within a multi-agent coding team.
You are given a specific subtask and the test file(s) that already specify
its required behavior. Your job is to write implementation code that makes
the given tests pass. Do not rewrite or weaken the tests themselves; if a
test appears genuinely wrong, say so in your summary instead of editing it.

Output a JSON code block:
\`\`\`json
{"diffs":[{"filePath":"...","operation":"create|modify|delete","diffContent":"...","language":"..."}],"summary":"..."}
\`\`\``.trim();
}

/**
 * Note: deliberately does not include the workflow's global `verifierVerdict`
 * — that reflects whichever part of the codebase was last verified, which is
 * not necessarily this node. A retry of this specific node should pass its
 * own prior failure explicitly (not implemented here — out of scope for the
 * initial pass) rather than inherit unrelated global verifier state.
 */
export function buildImplementorUserPrompt(node: TaskNode, state: WorkflowState, testFiles: DiffEntry[]): string {
  const parts: string[] = [
    `## Subtask\n${node.description}`,
    `## File(s) to implement\n${node.filesToTouch.join(', ')}`,
  ];

  if (testFiles.length > 0) {
    parts.push(`## Tests this must satisfy\n${testFiles.map(t => `${t.filePath}:\n${t.diffContent}`).join('\n')}`);
  }

  const conventions = filterConventionsByLanguage(state.agentsMdContext, state.task.languageIds);
  if (conventions) parts.push(`## Conventions\n${conventions}`);

  const scopedFindings = state.criticFindings.filter(f => node.filesToTouch.includes(f.file));
  if (scopedFindings.length > 0) {
    parts.push(`## Issues to address\n${scopedFindings.map(f => `[${f.ruleId}] ${f.message} -> ${f.resolutionHint}`).join('\n')}`);
  }

  return parts.join('\n\n');
}
