import Anthropic from '@anthropic-ai/sdk';
import type { IAgentProvider, AgentConfig, AgentResult, ToolCall } from '@tacv/core/interfaces';

export interface ClaudeProviderConfig {
  apiKey:          string;
  model?:          string;
  costPerMInput?:  number;
  costPerMOutput?: number;
}

const TOOL_DEFINITIONS: Record<string, Anthropic.Tool> = {
  read_file: {
    name: 'read_file',
    description: 'Read the contents of a file',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to workspace' } }, required: ['path'] },
  },
  write_file: {
    name: 'write_file',
    description: 'Write content to a file, creating it if it does not exist',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  list_directory: {
    name: 'list_directory',
    description: 'List files in a directory',
    input_schema: { type: 'object', properties: { path: { type: 'string', default: '.' } }, required: [] },
  },
  run_bash: {
    name: 'run_bash',
    description: 'Run a bash command in the sandbox',
    input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  },
  search_files: {
    name: 'search_files',
    description: 'Search for files matching a glob pattern',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, directory: { type: 'string', default: '.' } }, required: ['pattern'] },
  },
};

export class ClaudeAgentProvider implements IAgentProvider {
  private readonly client: Anthropic;
  private readonly model:  string;
  private readonly cpi:    number;
  private readonly cpo:    number;

  constructor(config: ClaudeProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model  = config.model         ?? 'claude-opus-4-6';
    this.cpi    = config.costPerMInput  ?? 5;
    this.cpo    = config.costPerMOutput ?? 30;
  }

  async runTask(prompt: string, _context: Record<string, unknown>, config: AgentConfig, _currentSpend: number): Promise<AgentResult> {
    const tools = config.allowedTools
      .filter(t => t in TOOL_DEFINITIONS)
      .map(t => TOOL_DEFINITIONS[t]!);

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
    const toolCalls: ToolCall[] = [];
    let inputTokens  = 0;
    let outputTokens = 0;
    let finalContent = '';
    let turns = 0;

    while (turns < config.maxTurns) {
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: 8192,
        system:     config.systemPrompt,
        messages,
        tools: tools.length > 0 ? tools : undefined,
      });

      inputTokens  += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      for (const block of response.content) {
        if (block.type === 'text') finalContent = block.text;
        if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown>, output: null });
      }

      if (response.stop_reason === 'end_turn' || tools.length === 0) break;
      if (response.stop_reason !== 'tool_use') break;

      // Build tool results for next turn
      const toolResults: Anthropic.ToolResultBlockParam[] = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result' as const, tool_use_id: b.id, content: `Tool ${b.name} executed (stub)` }));

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
      turns++;
    }

    const callCostUsd = (inputTokens / 1_000_000) * this.cpi + (outputTokens / 1_000_000) * this.cpo;

    return { content: finalContent, toolCalls, finishReason: 'end_turn', inputTokens, outputTokens, totalCostUsd: callCostUsd, callCostUsd };
  }
}
