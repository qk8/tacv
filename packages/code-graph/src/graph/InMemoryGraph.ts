export interface GraphNode { id: string; kind: string; metadata: Record<string, unknown> }
export interface GraphEdge { from: string; to: string; kind: string }

export class InMemoryGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges: GraphEdge[] = [];

  addNode(id: string, kind: string, metadata: Record<string, unknown> = {}): void {
    this.nodes.set(id, { id, kind, metadata });
  }

  addEdge(from: string, to: string, kind = 'imports'): void {
    this.edges.push({ from, to, kind });
  }

  getNode(id: string): GraphNode | undefined { return this.nodes.get(id); }

  getNeighbors(id: string): GraphNode[] {
    return this.edges
      .filter(e => e.from === id)
      .map(e => this.nodes.get(e.to))
      .filter((n): n is GraphNode => n !== undefined);
  }

  getImportersOf(id: string): string[] {
    return this.edges.filter(e => e.to === id).map(e => e.from);
  }

  getDependenciesOf(id: string): string[] {
    return this.edges.filter(e => e.from === id).map(e => e.to);
  }

  /** BFS: all nodes reachable from `startId` up to `maxDepth` hops */
  getReachable(startId: string, maxDepth = 5): Set<string> {
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
    while (queue.length > 0) {
      const item = queue.shift()!;
      if (visited.has(item.id) || item.depth > maxDepth) continue;
      visited.add(item.id);
      for (const edge of this.edges.filter(e => e.from === item.id)) {
        queue.push({ id: edge.to, depth: item.depth + 1 });
      }
    }
    return visited;
  }

  get nodeCount(): number { return this.nodes.size; }
  get edgeCount(): number { return this.edges.length; }
  clear(): void { this.nodes.clear(); this.edges.length = 0; }
}
