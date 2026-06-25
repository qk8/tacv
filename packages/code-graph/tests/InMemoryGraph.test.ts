import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraph } from '../src/graph/InMemoryGraph.js';

describe('InMemoryGraph', () => {
  let graph: InMemoryGraph;
  beforeEach(() => { graph = new InMemoryGraph(); });

  it('adds and retrieves nodes', () => {
    graph.addNode('src/A.ts', 'file', { language: 'typescript' });
    expect(graph.getNode('src/A.ts')).toBeDefined();
    expect(graph.getNode('src/A.ts')?.kind).toBe('file');
    expect(graph.nodeCount).toBe(1);
  });

  it('returns undefined for unknown node', () => {
    expect(graph.getNode('nonexistent')).toBeUndefined();
  });

  it('tracks edges and finds neighbors', () => {
    graph.addNode('src/A.ts', 'file');
    graph.addNode('src/B.ts', 'file');
    graph.addNode('src/C.ts', 'file');
    graph.addEdge('src/A.ts', 'src/B.ts');
    graph.addEdge('src/A.ts', 'src/C.ts');
    const neighbors = graph.getNeighbors('src/A.ts');
    expect(neighbors).toHaveLength(2);
    expect(neighbors.map(n => n.id)).toContain('src/B.ts');
  });

  it('getImportersOf finds reverse edges', () => {
    graph.addNode('src/util.ts', 'file');
    graph.addNode('src/A.ts', 'file');
    graph.addNode('src/B.ts', 'file');
    graph.addEdge('src/A.ts', 'src/util.ts');
    graph.addEdge('src/B.ts', 'src/util.ts');
    expect(graph.getImportersOf('src/util.ts')).toContain('src/A.ts');
    expect(graph.getImportersOf('src/util.ts')).toContain('src/B.ts');
  });

  it('getReachable performs BFS correctly', () => {
    graph.addNode('A', 'file'); graph.addNode('B', 'file');
    graph.addNode('C', 'file'); graph.addNode('D', 'file');
    graph.addEdge('A', 'B'); graph.addEdge('B', 'C'); graph.addEdge('C', 'D');
    const reachable = graph.getReachable('A');
    expect(reachable.has('B')).toBe(true);
    expect(reachable.has('C')).toBe(true);
    expect(reachable.has('D')).toBe(true);
  });

  it('getReachable respects maxDepth', () => {
    graph.addNode('A', 'f'); graph.addNode('B', 'f');
    graph.addNode('C', 'f'); graph.addNode('D', 'f');
    graph.addEdge('A', 'B'); graph.addEdge('B', 'C'); graph.addEdge('C', 'D');
    const reachable = graph.getReachable('A', 2);
    expect(reachable.has('B')).toBe(true);
    expect(reachable.has('C')).toBe(true);
    expect(reachable.has('D')).toBe(false);
  });

  it('clear resets the graph', () => {
    graph.addNode('A', 'file'); graph.addEdge('A', 'B');
    graph.clear();
    expect(graph.nodeCount).toBe(0);
    expect(graph.edgeCount).toBe(0);
  });
});
