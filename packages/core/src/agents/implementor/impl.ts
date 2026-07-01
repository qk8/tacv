/**
 * Implementor agent activity.
 *
 * Calls the agent provider with a narrow, role-scoped prompt for exactly one
 * DAG node, given the test file(s) the Test Writer already produced for that
 * node. Unlike the Test Writer, this role is allowed (expected) to produce
 * non-test files, so no role-based diff filtering is applied here — the
 * `node.filesToTouch` scope is enforced instead via the prompt and, in the
 * full workflow, via the same scope-violation check the original codebase
 * already applies to actor output.
 */

import { z } from 'zod';
import type { WorkflowState, DiffEntry } from '../../state/schemas.js';
import type { ActivityDeps } from '../../activities/ActivityDeps.js';
import type { TaskNode } from '../../planning/graph.js';
import { buildImplementorSystemPrompt, buildImplementorUserPrompt } from '../contextBuilders.js';
import type { AgentTeamResult } from '../types.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.agents.implementor');
const IMPLEMENTOR_PROMPT_VERSION = 'agent-team-v1';

const DiffOutput = z.object({
  diffs: z.array(z.object({
    filePath: z.string(), operation: z.enum(['create', 'modify', 'delete']),
    diffContent: z.string(), language: z.string(),
  })),
  summary: z.string(),
});

export async function implementorImpl(
  node: TaskNode,
  state: WorkflowState,
  testFiles: DiffEntry[],
  deps: ActivityDeps,
): Promise<AgentTeamResult> {
  const systemPrompt = buildImplementorSystemPrompt();
  const userPrompt = buildImplementorUserPrompt(node, state, testFiles);

  const result = await deps.agent.runTask(userPrompt, { repoPath: deps.repoPath }, {
    role: 'implementor', systemPrompt, maxTurns: 20,
    allowedTools: ['read_file', 'write_file', 'list_directory', 'run_bash', 'search_files'],
    promptVersion: IMPLEMENTOR_PROMPT_VERSION,
  }, state.cumulativeCostUsd);

  let diffs: DiffEntry[] = [];
  let summary = '';
  try {
    const jsonMatch = result.content.match(/```json\n([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      const parsed = DiffOutput.safeParse(JSON.parse(jsonMatch[1]));
      if (parsed.success) { diffs = parsed.data.diffs; summary = parsed.data.summary; }
    }
  } catch { /* leave diffs empty */ }

  log.info('implementor.complete', { nodeId: node.id, files: diffs.length, costUsd: result.callCostUsd.toFixed(4) });

  return { diffs, summary, costUsd: result.callCostUsd, roleViolations: [] };
}
