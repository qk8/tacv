import { describe, it, expect } from 'vitest';
import { buildSpeculativeBranchStates } from '../../../src/workflows/speculativeBranching.js';
import { createInitialState, type WorkflowState, type StrategyCandidate } from '../../../src/state/schemas.js';

const task = { taskId: 'sb1', description: 'Add caching', mode: 'BROWNFIELD' as const, moduleType: 'ts-backend', languageIds: ['typescript'] };

function candidate(id: string): StrategyCandidate {
  return { strategyId: id, description: `desc-${id}`, compositeScore: 0.5, estimatedRisk: 'medium', affectedFiles: [] };
}

function parentStateWithCheckpoint(): WorkflowState {
  return {
    ...createInitialState(task),
    cumulativeCostUsd: 8,
    criticFindings: [{ critic: 'security', severity: 'critical', file: 'a.ts', line: 1, ruleId: 'R', message: 'm', resolutionHint: 'h' }],
    gitCheckpoint: { commitHash: 'abc123', branch: 'tacv/sb1', checkpointAt: 1, changedFiles: [], cycleNumber: 1 },
  };
}

describe('buildSpeculativeBranchStates', () => {
  it('throws when there is no valid git checkpoint to fork from (mandatory, not opt-in)', () => {
    const parent = { ...parentStateWithCheckpoint(), gitCheckpoint: null };
    expect(() => buildSpeculativeBranchStates(parent, [candidate('a'), candidate('b')])).toThrow(/git checkpoint/i);
  });

  it('produces one start-state per candidate, each pruned of the parent failure history', () => {
    const states = buildSpeculativeBranchStates(parentStateWithCheckpoint(), [candidate('a'), candidate('b')]);
    expect(states).toHaveLength(2);
    for (const s of states) {
      expect(s.state.criticFindings).toEqual([]);
      expect(s.state.correctionCycle.attemptCount).toBe(0);
    }
  });

  it('assigns each branch a distinct taxonomy and attaches its directive as the selected strategy\'s guidance', () => {
    const states = buildSpeculativeBranchStates(parentStateWithCheckpoint(), [candidate('a'), candidate('b'), candidate('c')]);
    const taxonomies = states.map(s => s.taxonomy);
    expect(new Set(taxonomies).size).toBe(3);
    for (const s of states) {
      expect(s.state.selectedStrategy?.avoidHint).toBe(s.directive);
      expect(s.state.selectedStrategy?.strategyId).toBe(s.candidate.strategyId);
    }
  });

  it('preserves the shared budget context (cumulativeCostUsd) across all branches', () => {
    const states = buildSpeculativeBranchStates(parentStateWithCheckpoint(), [candidate('a')]);
    expect(states[0]!.state.cumulativeCostUsd).toBe(8);
  });
});
