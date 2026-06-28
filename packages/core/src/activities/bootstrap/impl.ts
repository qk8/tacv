import type { WorkflowState } from '../../state/schemas.js';
import { withAuditEntry } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const log = createLogger('tacv.bootstrap');

export async function bootstrapImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  log.info('bootstrap.start', { taskId: state.taskId });

  // Read AGENTS.md if present
  let agentsMdContext: string | null = null;
  try {
    const agentsMdPath = path.join(deps.repoPath, 'AGENTS.md');
    const content = await fs.readFile(agentsMdPath, 'utf8');
    agentsMdContext = content.slice(0, deps.config.agentsMdMaxChars);
    log.info('bootstrap.agents_md_loaded', { chars: agentsMdContext.length });
  } catch {
    log.info('bootstrap.agents_md_missing');
  }

  // Record session start in memory
  try {
    await deps.memory.add(
      `Task started: ${state.task.description}`,
      state.taskId, 'tacv-agent',
      { type: 'episodic', phase: 'session_start', mode: state.task.mode },
    );
  } catch (err) {
    log.warn('bootstrap.memory_add_failed', { error: String(err) });
  }

  return withAuditEntry({
    ...state,
    currentPhase: 'SCOUT',
    agentsMdContext,
  }, { node: 'bootstrap', decision: 'session_started', keyValues: { taskId: state.taskId, mode: state.task.mode } });
}
