import type { InMemoryGraph } from '../graph/InMemoryGraph.js';

export interface DependencySubgraph {
  roots:   string[];
  nodes:   string[];
  edges:   Array<{ from: string; to: string }>;
  cycles:  string[][];
}

export class DependencyAnalyzer {
  constructor(private readonly graph: InMemoryGraph) {}

  buildSubgraph(fileHints: string[], _repoPath: string): DependencySubgraph {
    const visited = new Set<string>();
    const edges: Array<{ from: string; to: string }> = [];

    const traverse = (nodeId: string, depth: number): void => {
      if (visited.has(nodeId) || depth > 8) return;
      visited.add(nodeId);
      for (const dep of this.graph.getDependenciesOf(nodeId)) {
        edges.push({ from: nodeId, to: dep });
        traverse(dep, depth + 1);
      }
    };

    for (const hint of fileHints) traverse(hint, 0);

    return {
      roots:  fileHints,
      nodes:  [...visited],
      edges,
      cycles: this._findCycles(fileHints),
    };
  }

  private _findCycles(startNodes: string[]): string[][] {
    const cycles: string[][] = [];
    const path:   string[]   = [];
    const inPath  = new Set<string>();

    const dfs = (node: string): void => {
      if (inPath.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) cycles.push(path.slice(cycleStart));
        return;
      }
      inPath.add(node);
      path.push(node);
      for (const dep of this.graph.getDependenciesOf(node)) dfs(dep);
      path.pop();
      inPath.delete(node);
    };

    for (const node of startNodes) dfs(node);
    return cycles.slice(0, 5);
  }
}
