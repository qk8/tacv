import { z } from 'zod';
import type { WorkflowState } from '../../state/schemas.js';
import { StrategyCandidate } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.replan');

const ReplanOutput = z.object({
  newStrategies: z.array(z.object({
    strategyId: z.string(), description: z.string(),
    compositeScore: z.number(), estimatedRisk: z.enum(['low','medium','high']),
    affectedFiles: z.array(z.string()),
  })),
  rationale: z.string(),
});

export async function replanImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  log.info('replan.start', { attempt: state.correctionCycle.attemptCount });

  const recentErrors = state.correctionCycle.rawErrorHistory?.slice(-3).join('\n---\n')
    ?? '(no error detail available)';

  const output = await deps.extractor.extract(
    `The current implementation strategy has failed ${state.correctionCycle.attemptCount} times.\nTask: ${state.task.description}\n\nPrevious strategies tried:\n${JSON.stringify(state.prunedStrategies)}\n\nError messages from recent failures:\n${recentErrors}\n\nGenerate 2 fresh strategies that approach this differently.`,
    ReplanOutput,
    { system: 'You are a senior engineer devising alternative implementation strategies after failed attempts.' },
  );

  return {
    ...state,
    currentPhase:       'ACTOR',
    strategyCandidates: output.newStrategies as StrategyCandidate[],
    prunedStrategies:   [...state.prunedStrategies, ...(state.selectedStrategy ? [state.selectedStrategy] : [])],
  };
}
