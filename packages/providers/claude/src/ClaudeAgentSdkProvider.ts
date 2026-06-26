/**
 * ClaudeAgentSdkProvider
 *
 * IAgentProvider implementation backed by @anthropic-ai/claude-agent-sdk.
 *
 * ## Key differences from ClaudeAgentProvider (@anthropic-ai/sdk):
 *
 *  - No manual turn loop — the Agent SDK manages turns internally via maxTurns.
 *  - No TOOL_DEFINITIONS JSON schemas — Read, Write, Bash, Glob, Grep are
 *    built-in tools; you only name them in allowedTools.
 *  - No ANTHROPIC_API_KEY in the constructor — the SDK reads it from the
 *    environment (ANTHROPIC_API_KEY), matching the pattern of the CLI.
 *  - permissionMode='acceptEdits' auto-accepts file reads and writes so Claude
 *    can modify code unattended. The Docker/Firecracker container is the security
 *    boundary; we never enable the Agent SDK's own sandbox.
 *  - cwd is set to context['repoPath'] so Claude operates inside the
 *    container-mounted repo, not the worker's own filesystem.
 *  - Cost is extracted from ResultMessage.usage at the end of the stream.
 *  - Tool calls are collected from AssistantMessage content blocks for traceability,
 *    but their execution is managed entirely by the SDK (output stays null).
 *  - Error results (is_error=true) surface as prefixed content rather than
 *    throwing, so Temporal does not retry the activity unnecessarily.
 *
 * @see packages/providers/docker/src/FirecrackerSandboxProvider.ts — sandbox impl
 * @see packages/core/src/activities/infrastructure/BudgetAwareAgent.ts — spend guard
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { IAgentProvider, AgentConfig, AgentResult, ToolCall } from '@tacv/core/interfaces';

// ── Tool name mapping ──────────────────────────────────────────────────────────

/**
 * Maps TACV's internal tool names (used throughout all activities and configs)
 * to the corresponding Claude Agent SDK built-in tool identifiers.
 *
 * Built-in tools shipped by the Agent SDK:
 *   Read  — read any file at a path
 *   Write — write / create a file with full content
 *   Edit  — apply an in-place patch (not used here; Actor emits full diffs)
 *   Bash  — run a shell command
 *   Glob  — find files matching a glob pattern (closest to list_directory)
 *   Grep  — regex-search file contents
 *   WebSearch / WebFetch — not granted to the coding Actor
 *
 * Unknown names are passed through unchanged for forward-compatibility
 * (a future built-in tool can be used by adding it to AgentConfig.allowedTools
 * without changing this file).
 */
export const TOOL_NAME_MAP: Record<string, string> = {
  read_file:      'Read',
  write_file:     'Write',
  list_directory: 'Glob',   // list a directory by globbing *, closest built-in
  run_bash:       'Bash',
  search_files:   'Grep',
} as const;

// ── Local type narrowing helpers ───────────────────────────────────────────────
//
// The Agent SDK's TypeScript types are evolving. We use local interfaces and
// runtime type guards rather than importing the SDK's discriminated union, so
// this file does not break when the SDK types change.

interface SdkResultMessage {
  type:       'result';
  subtype:    string;
  result:     string | undefined;
  is_error:   boolean;
  num_turns?: number;
  session_id?: string;
  usage?: {
    input_tokens:                 number;
    output_tokens:                number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?:     number;
  };
}

interface SdkToolUseBlock {
  type:  'tool_use';
  id:    string;
  name:  string;
  input: Record<string, unknown>;
}

interface SdkAssistantMessage {
  type:    'assistant';
  message: {
    content: Array<{ type: string } | SdkToolUseBlock>;
    [k: string]: unknown;
  };
}

function isResultMessage(m: unknown): m is SdkResultMessage {
  return (
    typeof m === 'object' && m !== null &&
    (m as { type?: unknown }).type === 'result'
  );
}

function isAssistantMessage(m: unknown): m is SdkAssistantMessage {
  return (
    typeof m === 'object' && m !== null &&
    (m as { type?: unknown }).type === 'assistant' &&
    typeof (m as { message?: unknown }).message === 'object' &&
    (m as { message?: unknown }).message !== null
  );
}

function isToolUseBlock(b: unknown): b is SdkToolUseBlock {
  return (
    typeof b === 'object' && b !== null &&
    (b as { type?: unknown }).type === 'tool_use' &&
    typeof (b as { id?: unknown }).id === 'string' &&
    typeof (b as { name?: unknown }).name === 'string'
  );
}

// ── Provider ───────────────────────────────────────────────────────────────────

export interface ClaudeAgentSdkProviderConfig {
  /**
   * Claude model to use for the agentic coding loop.
   * Default: 'claude-opus-4-6'
   */
  model?:          string;
  /**
   * Cost per 1M input tokens in USD. Passed to BudgetAwareAgent.
   * Default: 5 (Opus 4 list price at time of writing)
   */
  costPerMInput?:  number;
  /**
   * Cost per 1M output tokens in USD. Passed to BudgetAwareAgent.
   * Default: 30 (Opus 4 list price at time of writing)
   */
  costPerMOutput?: number;
}

export class ClaudeAgentSdkProvider implements IAgentProvider {
  private readonly model: string;
  private readonly cpi:   number;  // cost per million input tokens
  private readonly cpo:   number;  // cost per million output tokens

  constructor(config: ClaudeAgentSdkProviderConfig = {}) {
    this.model = config.model          ?? 'claude-opus-4-6';
    this.cpi   = config.costPerMInput  ?? 5;
    this.cpo   = config.costPerMOutput ?? 30;
  }

  /**
   * Run a coding task via the Claude Agent SDK.
   *
   * The SDK spawns Claude with built-in file tools and manages the turn loop
   * autonomously. We stream the response, collect the final ResultMessage for
   * cost data, and accumulate tool call metadata for audit traceability.
   *
   * @param prompt        - The user-facing task prompt (built by actorImpl)
   * @param context       - Must include repoPath: string pointing to the
   *                        Docker/Firecracker-mounted workspace
   * @param config        - Role, system prompt, maxTurns, allowedTools
   * @param _currentSpend - Cumulative spend from WorkflowState; BudgetAwareAgent
   *                        enforces the ceiling before this method is called
   */
  async runTask(
    prompt:         string,
    context:        Record<string, unknown>,
    config:         AgentConfig,
    _currentSpend:  number,
  ): Promise<AgentResult> {
    const repoPath    = typeof context['repoPath'] === 'string'
      ? context['repoPath']
      : process.cwd();

    const allowedTools = this.mapToolNames(config.allowedTools);

    // Accumulation state — filled as we iterate the stream
    let finalContent = '';
    let inputTokens  = 0;
    let outputTokens = 0;
    const toolCalls: ToolCall[] = [];

    for await (const message of query({
      prompt,
      options: {
        systemPrompt:   config.systemPrompt,
        maxTurns:       config.maxTurns,
        allowedTools,
        //
        // Security model:
        //   acceptEdits — auto-approve all file reads and writes.
        //   The Docker/Firecracker container is the security boundary;
        //   we do NOT enable the Agent SDK's own sandbox (which would conflict
        //   with the container and is not auditable by us).
        //
        permissionMode: 'acceptEdits' as const,
        cwd:            repoPath,
        model:          this.model,
        // sandbox is intentionally omitted — Docker/Firecracker handles isolation
      },
    })) {
      const msg = message as unknown;

      // ── ResultMessage: the final event in the stream ─────────────────────
      if (isResultMessage(msg)) {
        finalContent = msg.result ?? '';
        if (msg.usage) {
          inputTokens  = msg.usage.input_tokens  ?? 0;
          outputTokens = msg.usage.output_tokens ?? 0;
        }
        // Surface agent errors as prefixed content rather than throwing.
        // Throwing would cause Temporal to retry the whole activity, wasting
        // budget. The critics will detect the malformed diff and route to REPLAN.
        if (msg.is_error) {
          finalContent = `[Agent error] ${finalContent}`;
        }
        continue;
      }

      // ── AssistantMessage: collect tool_use blocks for audit trail ─────────
      if (isAssistantMessage(msg)) {
        const content = msg.message?.content ?? [];
        for (const block of content) {
          if (isToolUseBlock(block)) {
            toolCalls.push({
              id:     block.id,
              name:   block.name,
              input:  block.input,
              output: null,  // SDK manages execution; we record invocations only
            });
          }
        }
        continue;
      }

      // ── All other message types (system/init, user/tool_result, debug, …) ─
      // Silently ignored. We only consume what we need.
    }

    const callCostUsd = (inputTokens / 1_000_000) * this.cpi
                      + (outputTokens / 1_000_000) * this.cpo;

    return {
      content:      finalContent,
      toolCalls,
      finishReason: 'end_turn',
      inputTokens,
      outputTokens,
      totalCostUsd: callCostUsd,
      callCostUsd,
    };
  }

  /**
   * Map TACV's internal tool names to the Agent SDK's built-in tool identifiers.
   * Exposed as a public method so it can be tested in isolation and so that
   * LangfuseTracingAgent (which wraps this provider) can inspect the mapping
   * if needed in the future.
   */
  mapToolNames(tools: string[]): string[] {
    return tools.map(t => TOOL_NAME_MAP[t] ?? t);
  }
}
