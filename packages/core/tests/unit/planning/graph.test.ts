import { describe, it, expect } from 'vitest';
import { TaskGraph, CycleError, type TaskNode } from '../../../src/planning/graph.js';

function node(partial: Partial<TaskNode> & { id: string }): TaskNode {
  return {
    description: partial.description ?? `desc for ${partial.id}`,
    filesToTouch: partial.filesToTouch ?? [],
    dependsOn: partial.dependsOn ?? [],
    estimatedComplexity: partial.estimatedComplexity ?? 'medium',
    riskScore: partial.riskScore ?? 0.3,
    id: partial.id,
  };
}

describe('TaskGraph construction validation', () => {
  it('accepts a valid graph with no dependencies', () => {
    expect(() => new TaskGraph({ nodes: [node({ id: 'a' }), node({ id: 'b' })] })).not.toThrow();
  });

  it('rejects duplicate node ids', () => {
    expect(() => new TaskGraph({ nodes: [node({ id: 'a' }), node({ id: 'a' })] }))
      .toThrow(/duplicate/i);
  });

  it('rejects a dependency on a node id that does not exist', () => {
    expect(() => new TaskGraph({ nodes: [node({ id: 'a', dependsOn: ['ghost'] })] }))
      .toThrow(/unknown|missing|does not exist/i);
  });

  it('rejects a direct self-dependency', () => {
    expect(() => new TaskGraph({ nodes: [node({ id: 'a', dependsOn: ['a'] })] }))
      .toThrow(CycleError);
  });

  it('rejects an indirect cycle (a -> b -> a)', () => {
    expect(() => new TaskGraph({
      nodes: [node({ id: 'a', dependsOn: ['b'] }), node({ id: 'b', dependsOn: ['a'] })],
    })).toThrow(CycleError);
  });

  it('rejects a longer cycle (a -> b -> c -> a)', () => {
    expect(() => new TaskGraph({
      nodes: [
        node({ id: 'a', dependsOn: ['c'] }),
        node({ id: 'b', dependsOn: ['a'] }),
        node({ id: 'c', dependsOn: ['b'] }),
      ],
    })).toThrow(CycleError);
  });
});

describe('TaskGraph.topologicalOrder', () => {
  it('orders a simple chain a -> b -> c so dependencies precede dependents', () => {
    const graph = new TaskGraph({
      nodes: [
        node({ id: 'c', dependsOn: ['b'] }),
        node({ id: 'a' }),
        node({ id: 'b', dependsOn: ['a'] }),
      ],
    });
    expect(graph.topologicalOrder()).toEqual(['a', 'b', 'c']);
  });

  it('orders a diamond (a -> b, a -> c, b -> d, c -> d) with a first and d last', () => {
    const graph = new TaskGraph({
      nodes: [
        node({ id: 'd', dependsOn: ['b', 'c'] }),
        node({ id: 'b', dependsOn: ['a'] }),
        node({ id: 'c', dependsOn: ['a'] }),
        node({ id: 'a' }),
      ],
    });
    const order = graph.topologicalOrder();
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });

  it('returns a single-element order for a single-node graph', () => {
    const graph = new TaskGraph({ nodes: [node({ id: 'solo' })] });
    expect(graph.topologicalOrder()).toEqual(['solo']);
  });
});

describe('TaskGraph.parallelLanes', () => {
  it('puts fully independent nodes into a single lane together', () => {
    const graph = new TaskGraph({ nodes: [node({ id: 'a' }), node({ id: 'b' }), node({ id: 'c' })] });
    const lanes = graph.parallelLanes();
    expect(lanes).toHaveLength(1);
    expect(new Set(lanes[0])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('separates a diamond into 3 lanes: [a], [b,c], [d]', () => {
    const graph = new TaskGraph({
      nodes: [
        node({ id: 'a' }),
        node({ id: 'b', dependsOn: ['a'] }),
        node({ id: 'c', dependsOn: ['a'] }),
        node({ id: 'd', dependsOn: ['b', 'c'] }),
      ],
    });
    const lanes = graph.parallelLanes();
    expect(lanes).toHaveLength(3);
    expect(lanes[0]).toEqual(['a']);
    expect(new Set(lanes[1])).toEqual(new Set(['b', 'c']));
    expect(lanes[2]).toEqual(['d']);
  });

  it('handles a pure chain as N lanes of 1 (no parallelism available)', () => {
    const graph = new TaskGraph({
      nodes: [node({ id: 'a' }), node({ id: 'b', dependsOn: ['a'] }), node({ id: 'c', dependsOn: ['b'] })],
    });
    expect(graph.parallelLanes()).toEqual([['a'], ['b'], ['c']]);
  });
});

describe('TaskGraph.dependentsOf / isLeaf', () => {
  it('computes reverse edges (who depends on this node)', () => {
    const graph = new TaskGraph({
      nodes: [node({ id: 'a' }), node({ id: 'b', dependsOn: ['a'] }), node({ id: 'c', dependsOn: ['a'] })],
    });
    expect(new Set(graph.dependentsOf('a'))).toEqual(new Set(['b', 'c']));
    expect(graph.dependentsOf('b')).toEqual([]);
  });

  it('flags nodes nothing depends on as leaves (terminal outputs)', () => {
    const graph = new TaskGraph({
      nodes: [node({ id: 'a' }), node({ id: 'b', dependsOn: ['a'] })],
    });
    expect(graph.isLeaf('a')).toBe(false);
    expect(graph.isLeaf('b')).toBe(true);
  });
});

describe('TaskGraph.budgetFor — risk/complexity-proportional budget allocation', () => {
  it('allocates more budget to a high-complexity, high-risk node than a low-complexity, low-risk node', () => {
    const graph = new TaskGraph({
      nodes: [
        node({ id: 'risky', estimatedComplexity: 'high', riskScore: 0.8 }),
        node({ id: 'safe', estimatedComplexity: 'low', riskScore: 0.1 }),
      ],
    });
    const riskyBudget = graph.budgetFor('risky', 100);
    const safeBudget = graph.budgetFor('safe', 100);
    expect(riskyBudget).toBeGreaterThan(safeBudget);
  });

  it('allocates budgets that sum to (approximately) the total budget across all nodes', () => {
    const graph = new TaskGraph({
      nodes: [
        node({ id: 'a', estimatedComplexity: 'high', riskScore: 0.9 }),
        node({ id: 'b', estimatedComplexity: 'medium', riskScore: 0.4 }),
        node({ id: 'c', estimatedComplexity: 'low', riskScore: 0.1 }),
      ],
    });
    const total = graph.budgetFor('a', 90) + graph.budgetFor('b', 90) + graph.budgetFor('c', 90);
    expect(total).toBeCloseTo(90, 1);
  });

  it('splits budget evenly across nodes of identical complexity and risk', () => {
    const graph = new TaskGraph({
      nodes: [
        node({ id: 'a', estimatedComplexity: 'medium', riskScore: 0.5 }),
        node({ id: 'b', estimatedComplexity: 'medium', riskScore: 0.5 }),
      ],
    });
    expect(graph.budgetFor('a', 60)).toBeCloseTo(30, 5);
    expect(graph.budgetFor('b', 60)).toBeCloseTo(30, 5);
  });

  it('throws for an unknown node id', () => {
    const graph = new TaskGraph({ nodes: [node({ id: 'a' })] });
    expect(() => graph.budgetFor('ghost', 100)).toThrow(/unknown|missing|does not exist/i);
  });
});

describe('TaskGraph.fromImplementationPlan — adapter from the flat plan shape', () => {
  it('builds a graph from a flat files-to-create/modify list using simple heuristics: test files depend on their source files, and a shared "scaffolding" node precedes everything else when present', () => {
    const graph = TaskGraph.fromImplementationPlan({
      planSummary: 'Add JWT auth',
      filesToCreate: ['src/auth/AuthService.ts', 'src/auth/AuthService.test.ts'],
      filesToModify: ['src/app.ts'],
      filesToDelete: [],
      testFilesToCreate: ['src/auth/AuthService.test.ts'],
      estimatedComplexity: 'high',
      riskyAreas: ['src/auth/AuthService.ts'],
    });
    const order = graph.topologicalOrder();
    // The implementation node for AuthService must precede its test node.
    const implIdx = order.findIndex(id => graph.nodeFiles(id).includes('src/auth/AuthService.ts') && !graph.nodeFiles(id).includes('src/auth/AuthService.test.ts'));
    const testIdx = order.findIndex(id => graph.nodeFiles(id).includes('src/auth/AuthService.test.ts'));
    expect(implIdx).toBeGreaterThanOrEqual(0);
    expect(testIdx).toBeGreaterThanOrEqual(0);
    expect(implIdx).toBeLessThan(testIdx);
  });

  it('marks files listed in riskyAreas with an elevated riskScore on their node', () => {
    const graph = TaskGraph.fromImplementationPlan({
      planSummary: 'x', filesToCreate: ['src/risky.ts'], filesToModify: [], filesToDelete: [],
      testFilesToCreate: [], estimatedComplexity: 'medium', riskyAreas: ['src/risky.ts'],
    });
    const riskyNodeId = graph.topologicalOrder().find(id => graph.nodeFiles(id).includes('src/risky.ts'));
    expect(riskyNodeId).toBeDefined();
    expect(graph.riskScoreOf(riskyNodeId!)).toBeGreaterThan(0.5);
  });
});
