import { describe, it, expect, vi } from 'vitest';
import { ClaudeAgentProvider } from '../src/ClaudeAgentProvider.js';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Implementation complete.\n```json\n{"diffs":[],"summary":"done","testFilePaths":[]}\n```' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 500, output_tokens: 200 },
      }),
    },
  })),
}));

describe('ClaudeAgentProvider', () => {
  const provider = new ClaudeAgentProvider({ apiKey: 'sk-test', model: 'claude-opus-4-6', costPerMInput: 5, costPerMOutput: 30 });

  it('returns content from Claude response', async () => {
    const result = await provider.runTask('test prompt', {}, { role: 'actor', systemPrompt: 'You are an engineer', maxTurns: 1, allowedTools: [] }, 0);
    expect(result.content).toContain('Implementation complete');
  });

  it('computes callCostUsd from token usage', async () => {
    const result = await provider.runTask('test', {}, { role: 'actor', systemPrompt: '', maxTurns: 1, allowedTools: [] }, 0);
    expect(result.callCostUsd).toBeGreaterThan(0);
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(200);
  });

  it('returns end_turn finish reason', async () => {
    const result = await provider.runTask('test', {}, { role: 'actor', systemPrompt: '', maxTurns: 1, allowedTools: [] }, 0);
    expect(result.finishReason).toBe('end_turn');
  });
});
