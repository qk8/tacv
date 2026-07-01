/**
 * Test Writer agent activity.
 *
 * Calls the agent provider with a narrow, role-scoped prompt (see
 * `agents/contextBuilders.ts`) for exactly one DAG node, in TDD fashion —
 * test files only, no implementation. Role isolation is enforced twice:
 * once via the system prompt (soft constraint, an LLM instruction), and
 * once via a hard filter on the returned diffs (`enforceTestFileRole`) that
 * drops anything that doesn't look like a test file even if the agent
 * ignores the instruction. This is defense in depth — instruction-following
 * is probabilistic, the filter is not.
 */

import { z } from 'zod';
import type { WorkflowState, DiffEntry } from '../../state/schemas.js';
import type { ActivityDeps } from '../../activities/ActivityDeps.js';
import type { TaskNode } from '../../planning/graph.js';
import { buildTestWriterSystemPrompt, buildTestWriterUserPrompt } from '../contextBuilders.js';
import type { AgentTeamResult } from '../types.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.agents.test_writer');
const TEST_WRITER_PROMPT_VERSION = 'agent-team-v1';

const DiffOutput = z.object({
  diffs: z.array(z.object({
    filePath: z.string(), operation: z.enum(['create', 'modify', 'delete']),
    diffContent: z.string(), language: z.string(),
  })),
  summary: z.string(),
});

const TEST_FILE_PATTERN = /(\.(test|spec)\.[a-z]+$)|(^|\/)(tests?|__tests__)\//i;

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}

/** Hard enforcement: drop any diff that isn't a test file, recording each violation. */
function enforceTestFileRole(diffs: DiffEntry[]): { kept: DiffEntry[]; violations: string[] } {
  const kept: DiffEntry[] = [];
  const violations: string[] = [];
  for (const d of diffs) {
    if (isTestFile(d.filePath)) kept.push(d);
    else violations.push(`Test Writer attempted to produce a non-test file: ${d.filePath} — dropped.`);
  }
  return { kept, violations };
}

export async function testWriterImpl(
  node: TaskNode,
  state: WorkflowState,
  deps: ActivityDeps,
): Promise<AgentTeamResult> {
  const systemPrompt = buildTestWriterSystemPrompt();
  const userPrompt = buildTestWriterUserPrompt(node, state);

  const result = await deps.agent.runTask(userPrompt, { repoPath: deps.repoPath }, {
    role: 'test_writer', systemPrompt, maxTurns: 12,
    allowedTools: ['read_file', 'write_file', 'list_directory', 'search_files'],
    promptVersion: TEST_WRITER_PROMPT_VERSION,
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

  const { kept, violations } = enforceTestFileRole(diffs);
  if (violations.length > 0) {
    log.warn('test_writer.role_violation', { nodeId: node.id, violations });
  }

  log.info('test_writer.complete', { nodeId: node.id, files: kept.length, costUsd: result.callCostUsd.toFixed(4) });

  return { diffs: kept, summary, costUsd: result.callCostUsd, roleViolations: violations };
}
