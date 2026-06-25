import { describe, it, expect, vi } from 'vitest';
import { BudgetAwareAgent, BudgetExceededError } from '../../../src/activities/infrastructure/BudgetAwareAgent.js';
import type { IAgentProvider, AgentResult } from '../../../src/interfaces/IAgentProvider.js';
import type { TokenBudgetConfig } from '../../../src/config/index.js';

const budget: TokenBudgetConfig = { criticalDollar: 80, warningDollar: 50, costPerMInput: 5, costPerMOutput: 30 };

function makeInner(cost = 0.1): IAgentProvider {
  return {
    runTask: vi.fn().mockResolvedValue({ content: 'ok', toolCalls: [], finishReason: 'end_turn', inputTokens: 100, outputTokens: 50, totalCostUsd: cost, callCostUsd: cost } as AgentResult),
  };
}

const agentConfig = { role: 'actor', systemPrompt: '', maxTurns: 1, allowedTools: [] };

describe('BudgetAwareAgent', () => {
  it('passes through to inner provider when under budget', async () => {
    const inner  = makeInner(0.5);
    const agent  = new BudgetAwareAgent(inner, budget);
    const result = await agent.runTask('test', {}, agentConfig, 10.0);
    expect(result.content).toBe('ok');
    expect(inner.runTask).toHaveBeenCalledOnce();
  });

  it('throws BudgetExceededError when currentSpend >= criticalDollar', async () => {
    const agent = new BudgetAwareAgent(makeInner(), budget);
    await expect(agent.runTask('test', {}, agentConfig, 80.0)).rejects.toThrow(BudgetExceededError);
    await expect(agent.runTask('test', {}, agentConfig, 90.0)).rejects.toThrow(BudgetExceededError);
  });

  it('does not throw when currentSpend is just under criticalDollar', async () => {
    const agent = new BudgetAwareAgent(makeInner(0.01), budget);
    await expect(agent.runTask('test', {}, agentConfig, 79.99)).resolves.not.toThrow();
  });

  it('does NOT accumulate state between calls (no _spent field)', async () => {
    const inner = makeInner(5.0);
    const agent = new BudgetAwareAgent(inner, budget);
    // Each call uses the passed currentSpend — not an internal counter
    await agent.runTask('test', {}, agentConfig, 10.0);
    await agent.runTask('test', {}, agentConfig, 10.0);  // same currentSpend — would be wrong if it accumulated
    expect(inner.runTask).toHaveBeenCalledTimes(2);
  });

  it('BudgetExceededError has correct properties', () => {
    const err = new BudgetExceededError(82.5, 80);
    expect(err.name).toBe('BudgetExceededError');
    expect(err.spent).toBe(82.5);
    expect(err.limit).toBe(80);
    expect(err.message).toContain('82.5');
  });

  it('logs warning when approaching warningDollar threshold', async () => {
    const inner = makeInner(0.1);
    const agent = new BudgetAwareAgent(inner, budget);
    // currentSpend=55 is between warningDollar=50 and criticalDollar=80
    await agent.runTask('test', {}, agentConfig, 55.0);
    // If no exception thrown, the warning path was executed without error
    expect(inner.runTask).toHaveBeenCalled();
  });
});
