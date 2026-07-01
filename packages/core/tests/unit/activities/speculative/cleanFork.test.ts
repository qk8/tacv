import { describe, it, expect } from 'vitest';
import { pruneStateForFork, requireCleanForkBase, assignStrategyTaxonomy } from '../../../../src/activities/speculative/cleanFork.js';
import { createInitialState, type WorkflowState, type StrategyCandidate } from '../../../../src/state/schemas.js';

const task = { taskId: 'spec1', description: 'Add caching layer', mode: 'BROWNFIELD' as const, moduleType: 'ts-backend', languageIds: ['typescript'] };

function contaminatedState(): WorkflowState {
  const s = createInitialState(task);
  return {
    ...s,
    agentsMdContext: '## Conventions\nUse constructor injection.',
    implementationPlan: {
      planSummary: 'Add Redis cache', filesToCreate: ['src/cache/RedisCache.ts'], filesToModify: [],
      filesToDelete: [], testFilesToCreate: [], estimatedComplexity: 'medium', riskyAreas: [],
      criticsApproved: true, fastCriticFindings: [],
    },
    cumulativeCostUsd: 12.5,
    correctionCycle: {
      attemptCount: 4, branchName: 'main', lastErrorHash: 'abc123',
      errorHistory: ['abc123', 'def456', 'abc123'], rawErrorHistory: ['TypeError: x', 'TypeError: x', 'TypeError: x'],
      stagnationPattern: 'iteration', lastOutcomeSignature: 'sig1',
    },
    criticFindings: [{ critic: 'security', severity: 'critical', file: 'a.ts', line: null, ruleId: 'R1', message: 'm', resolutionHint: 'h' }],
    criticErrors: ['critic timeout'],
    debugObservations: {
      errorType: 'NULL_REFERENCE', rootCause: 'null pointer in cache key builder',
      breakpointHits: [], actuatorBeans: null, actuatorEnv: null, minimalPayload: null,
      playwrightTracePath: null, prunedStack: [],
    },
    workflowAuditTrail: [
      { timestampMs: 1, node: 'actor', decision: 'cycle_1', keyValues: {} },
      { timestampMs: 2, node: 'actor', decision: 'cycle_2', keyValues: {} },
    ],
    diffProposal: { diffs: [{ filePath: 'a.ts', operation: 'modify', diffContent: 'x', language: 'typescript' }], summary: 'failed attempt', testFilePaths: [] },
    verifierVerdict: { testResult: 'FAIL', diagnostic: 'FIX_IMPL', testFailures: [{ message: 'boom' }], blockedByCritic: false, confidenceScore: 0.3 },
    confidenceScore: 0.25,
    gitCheckpoint: { commitHash: 'deadbeef123', branch: 'tacv/spec1', checkpointAt: Date.now(), changedFiles: ['a.ts'], cycleNumber: 2 },
  };
}

describe('pruneStateForFork — strips contamination, preserves durable context', () => {
  it('clears prior-cycle failure history so the branch cannot see what already failed in another lineage', () => {
    const pruned = pruneStateForFork(contaminatedState());
    expect(pruned.correctionCycle?.rawErrorHistory).toEqual([]);
    expect(pruned.correctionCycle?.errorHistory).toEqual([]);
    expect(pruned.correctionCycle?.lastErrorHash).toBeNull();
    expect(pruned.correctionCycle?.stagnationPattern).toBe('none');
    expect(pruned.correctionCycle?.attemptCount).toBe(0);
  });

  it('clears critic findings, debug observations, and the failed diff proposal from the parent lineage', () => {
    const pruned = pruneStateForFork(contaminatedState());
    expect(pruned.criticFindings).toEqual([]);
    expect(pruned.criticErrors).toEqual([]);
    expect(pruned.debugObservations).toBeNull();
    expect(pruned.diffProposal).toBeNull();
    expect(pruned.verifierVerdict).toBeNull();
  });

  it('resets the branch-local audit trail rather than inheriting the parent\'s', () => {
    const pruned = pruneStateForFork(contaminatedState());
    expect(pruned.workflowAuditTrail).toEqual([]);
  });

  it('resets confidence score to a fresh 1.0 rather than inheriting the parent\'s depressed score', () => {
    const pruned = pruneStateForFork(contaminatedState());
    expect(pruned.confidenceScore).toBe(1.0);
  });

  it('PRESERVES durable context the branch still legitimately needs: task, AGENTS.md conventions, and the implementation plan', () => {
    const pruned = pruneStateForFork(contaminatedState());
    expect(pruned.task).toEqual(task);
    expect(pruned.agentsMdContext).toContain('constructor injection');
    expect(pruned.implementationPlan?.planSummary).toBe('Add Redis cache');
  });

  it('PRESERVES cumulative cost — money already spent is real and must still count against the shared budget', () => {
    const pruned = pruneStateForFork(contaminatedState());
    expect(pruned.cumulativeCostUsd).toBe(12.5);
  });
});

describe('requireCleanForkBase — mandatory git checkpoint, not opt-in', () => {
  it('returns the commit hash when a valid checkpoint exists', () => {
    expect(requireCleanForkBase(contaminatedState())).toBe('deadbeef123');
  });

  it('throws when gitCheckpoint is null (no silent "dirty-tree" fallback)', () => {
    const s = { ...contaminatedState(), gitCheckpoint: null };
    expect(() => requireCleanForkBase(s)).toThrow(/git checkpoint/i);
  });

  it('throws when gitCheckpoint exists but commitHash is null (git was unavailable)', () => {
    const s = { ...contaminatedState(), gitCheckpoint: { commitHash: null, branch: 'x', checkpointAt: 1, changedFiles: [], cycleNumber: 1 } };
    expect(() => requireCleanForkBase(s)).toThrow(/git checkpoint/i);
  });
});

describe('assignStrategyTaxonomy — positive, distinct strategic directives', () => {
  function candidate(id: string): StrategyCandidate {
    return { strategyId: id, description: `desc-${id}`, compositeScore: 0.5, estimatedRisk: 'medium', affectedFiles: [] };
  }

  it('assigns a distinct taxonomy to each of 3 candidates', () => {
    const assigned = assignStrategyTaxonomy([candidate('a'), candidate('b'), candidate('c')]);
    const taxonomies = assigned.map(a => a.taxonomy);
    expect(new Set(taxonomies).size).toBe(3);
  });

  it('cycles taxonomies when there are more candidates than taxonomy types', () => {
    const assigned = assignStrategyTaxonomy([candidate('a'), candidate('b'), candidate('c'), candidate('d')]);
    expect(assigned[0].taxonomy).toBe(assigned[3].taxonomy);
  });

  it('produces a constructive (positive) directive, not merely a negative "do not do X" instruction', () => {
    const assigned = assignStrategyTaxonomy([candidate('a')]);
    const directive = assigned[0].directive.toLowerCase();
    expect(directive.startsWith('do not')).toBe(false);
    expect(directive.length).toBeGreaterThan(10);
  });

  it('gives genuinely different directive text for different taxonomies (not just a label swap)', () => {
    const assigned = assignStrategyTaxonomy([candidate('a'), candidate('b'), candidate('c')]);
    const directives = assigned.map(a => a.directive);
    expect(new Set(directives).size).toBe(3);
  });

  it('preserves the original candidate fields unchanged', () => {
    const assigned = assignStrategyTaxonomy([candidate('a')]);
    expect(assigned[0].candidate.strategyId).toBe('a');
    expect(assigned[0].candidate.description).toBe('desc-a');
  });
});
