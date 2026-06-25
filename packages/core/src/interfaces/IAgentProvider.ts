export interface AgentConfig {
  readonly role:          string;
  readonly systemPrompt:  string;
  readonly maxTurns:      number;
  readonly allowedTools:  string[];
  readonly promptVersion?: string;
}

export interface ToolCall {
  readonly id:     string;
  readonly name:   string;
  readonly input:  Record<string, unknown>;
  readonly output: string | null;
}

export interface AgentResult {
  readonly content:      string;
  readonly toolCalls:    ToolCall[];
  readonly finishReason: 'end_turn' | 'max_tokens' | 'tool_use';
  readonly inputTokens:  number;
  readonly outputTokens: number;
  readonly totalCostUsd: number | null;
  readonly callCostUsd:  number;
}

export interface IAgentProvider {
  runTask(
    prompt:       string,
    context:      Record<string, unknown>,
    config:       AgentConfig,
    currentSpend: number,
  ): Promise<AgentResult>;
}
