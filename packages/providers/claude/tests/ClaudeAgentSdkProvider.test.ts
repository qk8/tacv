/**
 * ClaudeAgentSdkProvider — TDD test suite.
 *
 * Tests are written against the IAgentProvider contract and the specific
 * invariants that differ from ClaudeAgentProvider:
 *
 *   1. query() is called — no messages[] loop.
 *   2. allowedTools are mapped from TACV names → Agent SDK built-in names.
 *   3. permissionMode is always 'acceptEdits' (Docker is the security boundary).
 *   4. The Agent SDK sandbox is never enabled.
 *   5. cwd comes from context.repoPath.
 *   6. Cost is extracted from ResultMessage.usage.
 *   7. Tool calls are collected from AssistantMessage content.
 *   8. Error results surface as content rather than throwing (Temporal retry guard).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeAgentSdkProvider, TOOL_NAME_MAP } from '../src/ClaudeAgentSdkProvider.js';

// ── Mock @anthropic-ai/claude-agent-sdk ────────────────────────────────────────

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
const mockQuery = vi.mocked(query);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a mock AsyncIterable that yields the given items then completes. */
function makeStream<T>(...items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const buf = [...items];
      let i = 0;
      return {
        async next(): Promise<IteratorResult<T>> {
          if (i >= buf.length) return { done: true, value: undefined as unknown as T };
          return { done: false, value: buf[i++]! };
        },
      };
    },
  };
}

// ── Fixture messages ───────────────────────────────────────────────────────────

const SUCCESS_RESULT = {
  type:       'result',
  subtype:    'success',
  result:     '```json\n{"diffs":[],"summary":"Task complete","testFilePaths":[]}\n```',
  is_error:   false,
  num_turns:  3,
  session_id: 'sess-abc-123',
  usage:      { input_tokens: 2000, output_tokens: 800 },
};

const ASSISTANT_WITH_TOOL = {
  type: 'assistant',
  message: {
    content: [
      { type: 'text',     text: 'Reading the file first…' },
      { type: 'tool_use', id: 'tu-001', name: 'Read', input: { path: 'src/auth.ts' } },
    ],
  },
};

const ASSISTANT_NO_TOOL = {
  type:    'assistant',
  message: { content: [{ type: 'text', text: 'Here is the answer.' }] },
};

const SYSTEM_INIT = {
  type:       'system',
  subtype:    'init',
  session_id: 'sess-xyz',
  tools:      ['Read', 'Write', 'Bash'],
};

const DEFAULT_CONFIG = {
  role:          'actor',
  systemPrompt:  'You are an expert TypeScript developer.',
  maxTurns:      20,
  allowedTools:  ['read_file', 'write_file', 'list_directory', 'run_bash', 'search_files'],
  promptVersion: '2026-06-15-v2',
} as const;

const DEFAULT_CONTEXT = { repoPath: '/workspace/my-project' };

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ClaudeAgentSdkProvider', () => {
  let provider: ClaudeAgentSdkProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ClaudeAgentSdkProvider({ costPerMInput: 5, costPerMOutput: 30 });
  });

  // ── Exported constant ────────────────────────────────────────────────────────

  describe('TOOL_NAME_MAP', () => {
    it('maps all five TACV tool names to Agent SDK built-in identifiers', () => {
      expect(TOOL_NAME_MAP['read_file']).toBe('Read');
      expect(TOOL_NAME_MAP['write_file']).toBe('Write');
      expect(TOOL_NAME_MAP['list_directory']).toBe('Glob');
      expect(TOOL_NAME_MAP['run_bash']).toBe('Bash');
      expect(TOOL_NAME_MAP['search_files']).toBe('Grep');
    });

    it('has exactly five entries — no accidental extras', () => {
      expect(Object.keys(TOOL_NAME_MAP)).toHaveLength(5);
    });
  });

  // ── mapToolNames() ───────────────────────────────────────────────────────────

  describe('mapToolNames()', () => {
    it('maps all five TACV tool names in one call', () => {
      const mapped = provider.mapToolNames([
        'read_file', 'write_file', 'list_directory', 'run_bash', 'search_files',
      ]);
      expect(mapped).toEqual(['Read', 'Write', 'Glob', 'Bash', 'Grep']);
    });

    it('passes unknown tool names through unchanged (forward-compatibility)', () => {
      const mapped = provider.mapToolNames(['read_file', 'some_future_tool']);
      expect(mapped).toEqual(['Read', 'some_future_tool']);
    });

    it('handles an empty allowedTools list', () => {
      expect(provider.mapToolNames([])).toEqual([]);
    });

    it('maps a single tool correctly', () => {
      expect(provider.mapToolNames(['run_bash'])).toEqual(['Bash']);
    });

    it('preserves order', () => {
      expect(provider.mapToolNames(['run_bash', 'read_file'])).toEqual(['Bash', 'Read']);
    });
  });

  // ── query() call arguments ───────────────────────────────────────────────────

  describe('query() call arguments', () => {
    beforeEach(() => {
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
    });

    it('calls query() exactly once per runTask() invocation', async () => {
      await provider.runTask('Fix the auth bug', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('passes the prompt verbatim as the top-level prompt field', async () => {
      await provider.runTask('Fix the auth bug', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      const arg = mockQuery.mock.calls[0]![0] as Record<string, unknown>;
      expect(arg['prompt']).toBe('Fix the auth bug');
    });

    it('passes systemPrompt from AgentConfig', async () => {
      await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      const opts = getOptions();
      expect(opts['systemPrompt']).toBe('You are an expert TypeScript developer.');
    });

    it('passes maxTurns from AgentConfig', async () => {
      await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(getOptions()['maxTurns']).toBe(20);
    });

    it('maps allowedTools from TACV names to Agent SDK built-in names', async () => {
      await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(getOptions()['allowedTools']).toEqual(['Read', 'Write', 'Glob', 'Bash', 'Grep']);
    });

    it('always sets permissionMode to acceptEdits — Docker/Firecracker is the security boundary', async () => {
      await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(getOptions()['permissionMode']).toBe('acceptEdits');
    });

    it('uses context.repoPath as the cwd option', async () => {
      await provider.runTask('task', { repoPath: '/sandbox/repo-123' }, DEFAULT_CONFIG, 0);
      expect(getOptions()['cwd']).toBe('/sandbox/repo-123');
    });

    it('falls back to process.cwd() when repoPath is absent from context', async () => {
      await provider.runTask('task', {}, DEFAULT_CONFIG, 0);
      expect(getOptions()['cwd']).toBe(process.cwd());
    });

    it('does NOT enable the Agent SDK built-in sandbox (Docker is the security boundary)', async () => {
      await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      const opts = getOptions();
      // sandbox field must be absent or explicitly falsy
      expect(opts['sandbox']).toBeFalsy();
    });

    it('passes the configured model', async () => {
      const p = new ClaudeAgentSdkProvider({ model: 'claude-haiku-4-5-20251001' });
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      await p.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      const opts = getOptions();
      expect(opts['model']).toBe('claude-haiku-4-5-20251001');
    });

    it('defaults to claude-opus-4-6 when no model is configured', async () => {
      const p = new ClaudeAgentSdkProvider();
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      await p.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(getOptions()['model']).toBe('claude-opus-4-6');
    });

    /** Helper: extract options from the first mockQuery call */
    function getOptions(): Record<string, unknown> {
      const arg = mockQuery.mock.calls[0]![0] as Record<string, unknown>;
      return (arg['options'] ?? {}) as Record<string, unknown>;
    }
  });

  // ── Result content extraction ────────────────────────────────────────────────

  describe('result content extraction', () => {
    it('extracts the result string from the ResultMessage', async () => {
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.content).toContain('"summary":"Task complete"');
    });

    it('returns empty string when result field is absent', async () => {
      const noResult = { ...SUCCESS_RESULT, result: undefined };
      mockQuery.mockReturnValue(makeStream(noResult) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.content).toBe('');
    });

    it('always sets finishReason to end_turn', async () => {
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.finishReason).toBe('end_turn');
    });

    it('uses the last result message when multiple appear in the stream', async () => {
      const first  = { ...SUCCESS_RESULT, result: 'first', usage: { input_tokens: 100, output_tokens: 10 } };
      const second = { ...SUCCESS_RESULT, result: 'second', usage: { input_tokens: 999, output_tokens: 1 } };
      mockQuery.mockReturnValue(makeStream(first, second) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.content).toBe('second');
      expect(r.inputTokens).toBe(999);
    });

    it('prefixes content with [Agent error] when is_error is true', async () => {
      const errorMsg = {
        type: 'result', subtype: 'error_during_execution',
        result: 'Bash tool failed: permission denied', is_error: true,
        usage: { input_tokens: 300, output_tokens: 80 },
      };
      mockQuery.mockReturnValue(makeStream(errorMsg) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.content).toBe('[Agent error] Bash tool failed: permission denied');
    });

    it('handles error_max_turns subtype without throwing', async () => {
      const maxTurnsError = {
        type: 'result', subtype: 'error_max_turns',
        result: 'Max turns reached', is_error: true,
        usage: { input_tokens: 5000, output_tokens: 2000 },
      };
      mockQuery.mockReturnValue(makeStream(maxTurnsError) as ReturnType<typeof query>);
      await expect(provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0)).resolves.toBeDefined();
    });

    it('returns empty content and zero cost when stream ends with no result message', async () => {
      mockQuery.mockReturnValue(makeStream(SYSTEM_INIT) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.content).toBe('');
      expect(r.callCostUsd).toBe(0);
    });
  });

  // ── Token usage & cost ───────────────────────────────────────────────────────

  describe('token usage and cost calculation', () => {
    it('extracts input_tokens from ResultMessage.usage', async () => {
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.inputTokens).toBe(2000);
    });

    it('extracts output_tokens from ResultMessage.usage', async () => {
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.outputTokens).toBe(800);
    });

    it('calculates callCostUsd correctly: (in/1M)*cpi + (out/1M)*cpo', async () => {
      // cpi=5 cpo=30; input=2000 output=800
      // (2000/1_000_000)*5 + (800/1_000_000)*30 = 0.01/1000 + 0.024/1000 = 0.000034
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.callCostUsd).toBeCloseTo(0.000034, 8);
    });

    it('sets totalCostUsd equal to callCostUsd', async () => {
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.totalCostUsd).toBe(r.callCostUsd);
    });

    it('returns zero cost when ResultMessage.usage is absent', async () => {
      const noUsage = { ...SUCCESS_RESULT, usage: undefined };
      mockQuery.mockReturnValue(makeStream(noUsage) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.callCostUsd).toBe(0);
      expect(r.inputTokens).toBe(0);
      expect(r.outputTokens).toBe(0);
    });

    it('applies custom cost rates set in constructor', async () => {
      const cheapProvider = new ClaudeAgentSdkProvider({ costPerMInput: 1, costPerMOutput: 2 });
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      const r = await cheapProvider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      // (2000/1M)*1 + (800/1M)*2 = 0.000002 + 0.0000016 = 0.0000036
      expect(r.callCostUsd).toBeCloseTo(0.0000036, 9);
    });

    it('correctly applies default rates cpi=5 cpo=30 when not configured', async () => {
      const p = new ClaudeAgentSdkProvider();
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      const r = await p.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.callCostUsd).toBeCloseTo(0.000034, 8);
    });
  });

  // ── Tool call collection ─────────────────────────────────────────────────────

  describe('tool call collection', () => {
    it('collects a tool_use block from an AssistantMessage', async () => {
      mockQuery.mockReturnValue(
        makeStream(ASSISTANT_WITH_TOOL, SUCCESS_RESULT) as ReturnType<typeof query>,
      );
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.toolCalls).toHaveLength(1);
      expect(r.toolCalls[0]).toMatchObject({
        id:    'tu-001',
        name:  'Read',
        input: { path: 'src/auth.ts' },
      });
    });

    it('sets output to null for every collected tool call (SDK manages execution)', async () => {
      mockQuery.mockReturnValue(
        makeStream(ASSISTANT_WITH_TOOL, SUCCESS_RESULT) as ReturnType<typeof query>,
      );
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.toolCalls[0]!.output).toBeNull();
    });

    it('collects tool calls across multiple AssistantMessages', async () => {
      const msg2 = {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu-002', name: 'Write', input: { path: 'src/auth.ts', content: '...' } },
          ],
        },
      };
      mockQuery.mockReturnValue(
        makeStream(ASSISTANT_WITH_TOOL, msg2, SUCCESS_RESULT) as ReturnType<typeof query>,
      );
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.toolCalls).toHaveLength(2);
      expect(r.toolCalls.map(tc => tc.id)).toEqual(['tu-001', 'tu-002']);
    });

    it('skips text blocks — only tool_use blocks are collected', async () => {
      mockQuery.mockReturnValue(
        makeStream(ASSISTANT_WITH_TOOL, SUCCESS_RESULT) as ReturnType<typeof query>,
      );
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      // ASSISTANT_WITH_TOOL has one text block + one tool_use block
      expect(r.toolCalls).toHaveLength(1);
    });

    it('returns an empty toolCalls array when no tools were invoked', async () => {
      mockQuery.mockReturnValue(
        makeStream(ASSISTANT_NO_TOOL, SUCCESS_RESULT) as ReturnType<typeof query>,
      );
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.toolCalls).toEqual([]);
    });

    it('returns an empty toolCalls array for a stream with only a result message', async () => {
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.toolCalls).toEqual([]);
    });
  });

  // ── Stream robustness ────────────────────────────────────────────────────────

  describe('stream robustness', () => {
    it('processes system init messages without error', async () => {
      mockQuery.mockReturnValue(
        makeStream(SYSTEM_INIT, ASSISTANT_WITH_TOOL, SUCCESS_RESULT) as ReturnType<typeof query>,
      );
      await expect(provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0)).resolves.toBeDefined();
    });

    it('ignores completely unknown message types gracefully', async () => {
      const unknown = { type: 'debug', payload: { internal: true } };
      mockQuery.mockReturnValue(
        makeStream(unknown, SUCCESS_RESULT) as ReturnType<typeof query>,
      );
      await expect(provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0)).resolves.toBeDefined();
    });

    it('handles AssistantMessage with empty content array', async () => {
      const emptyContent = { type: 'assistant', message: { content: [] } };
      mockQuery.mockReturnValue(
        makeStream(emptyContent, SUCCESS_RESULT) as ReturnType<typeof query>,
      );
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(r.toolCalls).toEqual([]);
    });

    it('handles AssistantMessage with missing message field', async () => {
      const malformed = { type: 'assistant' }; // no .message
      mockQuery.mockReturnValue(
        makeStream(malformed, SUCCESS_RESULT) as ReturnType<typeof query>,
      );
      await expect(provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0)).resolves.toBeDefined();
    });
  });

  // ── _currentSpend passthrough ────────────────────────────────────────────────

  describe('_currentSpend parameter', () => {
    it('accepts any currentSpend value — BudgetAwareAgent handles enforcement', async () => {
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      // Should not throw at 0, 50, or above any threshold
      await expect(provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0)).resolves.toBeDefined();
      await expect(provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 50)).resolves.toBeDefined();
      await expect(provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 9999)).resolves.toBeDefined();
    });
  });

  // ── IAgentProvider interface compliance ─────────────────────────────────────

  describe('IAgentProvider interface compliance', () => {
    it('returns an object with all required AgentResult fields', async () => {
      mockQuery.mockReturnValue(makeStream(SUCCESS_RESULT) as ReturnType<typeof query>);
      const r = await provider.runTask('task', DEFAULT_CONTEXT, DEFAULT_CONFIG, 0);
      expect(typeof r.content).toBe('string');
      expect(Array.isArray(r.toolCalls)).toBe(true);
      expect(['end_turn', 'max_tokens', 'tool_use']).toContain(r.finishReason);
      expect(typeof r.inputTokens).toBe('number');
      expect(typeof r.outputTokens).toBe('number');
      expect(typeof r.callCostUsd).toBe('number');
    });
  });
});
