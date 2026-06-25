import type { IAgentProvider, AgentConfig, AgentResult } from '../../interfaces/IAgentProvider.js';
import type { TokenBudgetConfig } from '../../config/index.js';
import { createLogger } from '../../observability/logger.js';

const log = createLogger('tacv.budget');

export class BudgetExceededError extends Error {
  constructor(public readonly spent: number, public readonly limit: number) {
    super(`Token budget exceeded: $${spent.toFixed(4)} >= $${limit.toFixed(4)}`);
    this.name = 'BudgetExceededError';
  }
}

/**
 * Transparent decorator that enforces a token budget.
 * Cost accumulation is authoritative in WorkflowState (durable in Temporal).
 * This class only enforces the pre-call guard and emits per-call logs.
 * It does NOT hold cumulative state (fixes the retry-on-different-worker bug from SACV).
 */
export class BudgetAwareAgent implements IAgentProvider {
  constructor(
    private readonly inner:  IAgentProvider,
    private readonly budget: TokenBudgetConfig,
  ) {}

  async runTask(
    prompt:       string,
    context:      Record<string, unknown>,
    config:       AgentConfig,
    currentSpend: number,  // passed from WorkflowState — authoritative cumulative cost
  ): Promise<AgentResult> {
    if (currentSpend >= this.budget.criticalDollar) {
      throw new BudgetExceededError(currentSpend, this.budget.criticalDollar);
    }

    if (currentSpend >= this.budget.warningDollar) {
      log.warn('budget.warning', {
        spent:     currentSpend.toFixed(4),
        threshold: this.budget.warningDollar,
        role:      config.role,
      });
    }

    const result = await this.inner.runTask(prompt, context, config, currentSpend);

    const callCost = result.callCostUsd;
    const newTotal = currentSpend + callCost;

    log.info('llm.call', {
      role:              config.role,
      callCostUsd:       callCost.toFixed(6),
      newCumulativeUsd:  newTotal.toFixed(4),
      inputTokens:       result.inputTokens,
      outputTokens:      result.outputTokens,
      promptVersion:     config.promptVersion,
    });

    return result;
  }
}
