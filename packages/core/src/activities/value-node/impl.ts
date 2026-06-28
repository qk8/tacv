import { z } from 'zod';
import type { WorkflowState, StrategyCandidate } from '../../state/schemas.js';
import { withAuditEntry } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';

const DefaultStrategySchema = z.object({
  strategyId: z.string(), description: z.string(),
  compositeScore: z.number(), estimatedRisk: z.enum(['low','medium','high']),
  affectedFiles: z.array(z.string()),
});

const log = createLogger('tacv.value_node');

const ValueNodeOutput = z.object({
  selectedStrategy: z.object({
    strategyId: z.string(), description: z.string(),
    compositeScore: z.number(), estimatedRisk: z.enum(['low','medium','high']),
    affectedFiles: z.array(z.string()),
  }),
  prunedStrategies: z.array(z.object({
    strategyId: z.string(), description: z.string(),
    compositeScore: z.number(), estimatedRisk: z.enum(['low','medium','high']),
    affectedFiles: z.array(z.string()),
  })),
  rationale: z.string(),
});

export async function valueNodeImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  log.info('value_node.start', { candidates: state.strategyCandidates.length });
  if (state.strategyCandidates.length === 0) {
    log.warn('value_node.no_candidates', {
      taskId: state.taskId,
      hint: 'Scout returned 0 strategy candidates. Using task description as sole guidance.',
    });
    const defaultStrategy: StrategyCandidate = {
      strategyId:      'default-direct',
      description:     `Implement directly: ${state.task.description.slice(0, 200)}`,
      compositeScore:  0.5,
      estimatedRisk:   'medium',
      affectedFiles:   [],
    };
    return withAuditEntry({
      ...state,
      currentPhase:     'TDD_GATE',
      selectedStrategy: defaultStrategy,
    }, { node: 'value_node', decision: 'default_strategy_used', keyValues: { reason: 'no_scout_candidates' } });
  }

  const output = await deps.extractor.extract(
    `Select the best implementation strategy from these candidates:\n${JSON.stringify(state.strategyCandidates, null, 2)}\n\nTask: ${state.task.description}\nMode: ${state.task.mode}`,
    ValueNodeOutput,
    { system: 'You are a technical lead selecting the optimal implementation strategy. Prioritize low risk and high deliverability.' },
  );

  log.info('value_node.complete', { selected: output.selectedStrategy.strategyId });

  return withAuditEntry({
    ...state,
    currentPhase:    'TDD_GATE',
    selectedStrategy: output.selectedStrategy as StrategyCandidate,
    prunedStrategies: output.prunedStrategies as StrategyCandidate[],
  }, { node: 'value_node', decision: `selected_${output.selectedStrategy.strategyId}`, keyValues: { rationale: output.rationale, risk: output.selectedStrategy.estimatedRisk } });
}
