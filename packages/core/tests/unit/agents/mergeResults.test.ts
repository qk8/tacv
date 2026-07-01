import { describe, it, expect } from 'vitest';
import { mergeAgentTeamDiffs } from '../../../src/agents/mergeResults.js';
import type { AgentTeamResult } from '../../../src/agents/types.js';

function result(partial: Partial<AgentTeamResult>): AgentTeamResult {
  return { diffs: [], summary: '', costUsd: 0, roleViolations: [], ...partial };
}

describe('mergeAgentTeamDiffs', () => {
  it('concatenates diffs from multiple node results in order', () => {
    const merged = mergeAgentTeamDiffs([
      result({ diffs: [{ filePath: 'a.test.ts', operation: 'create', diffContent: 'x', language: 'typescript' }] }),
      result({ diffs: [{ filePath: 'a.ts', operation: 'create', diffContent: 'y', language: 'typescript' }] }),
    ]);
    expect(merged.diffs.map(d => d.filePath)).toEqual(['a.test.ts', 'a.ts']);
  });

  it('sums cost across all node results', () => {
    const merged = mergeAgentTeamDiffs([result({ costUsd: 0.5 }), result({ costUsd: 1.2 })]);
    expect(merged.totalCostUsd).toBeCloseTo(1.7, 5);
  });

  it('derives testFilePaths from diffs matching the test-file pattern', () => {
    const merged = mergeAgentTeamDiffs([
      result({ diffs: [
        { filePath: 'src/a.test.ts', operation: 'create', diffContent: 'x', language: 'typescript' },
        { filePath: 'src/a.ts', operation: 'create', diffContent: 'y', language: 'typescript' },
      ] }),
    ]);
    expect(merged.diffProposal.testFilePaths).toEqual(['src/a.test.ts']);
  });

  it('joins per-node summaries into one combined summary', () => {
    const merged = mergeAgentTeamDiffs([result({ summary: 'wrote tests for A' }), result({ summary: 'implemented A' })]);
    expect(merged.diffProposal.summary).toContain('wrote tests for A');
    expect(merged.diffProposal.summary).toContain('implemented A');
  });

  it('aggregates role violations across all nodes for audit visibility', () => {
    const merged = mergeAgentTeamDiffs([
      result({ roleViolations: ['violation 1'] }),
      result({ roleViolations: ['violation 2'] }),
    ]);
    expect(merged.roleViolations).toEqual(['violation 1', 'violation 2']);
  });

  it('handles an empty result list without throwing', () => {
    const merged = mergeAgentTeamDiffs([]);
    expect(merged.diffProposal.diffs).toEqual([]);
    expect(merged.totalCostUsd).toBe(0);
  });
});
