/**
 * DAG-based execution planning.
 *
 * ── Problem this replaces ───────────────────────────────────────────────────
 * The original `ImplementationPlan` is a flat shopping list:
 * `{ filesToCreate, filesToModify, filesToDelete, testFilesToCreate }`. It
 * carries no ordering information, so the actor implements files in whatever
 * order it chooses — frequently wrong (a test file referencing a service that
 * doesn't exist yet, an implementation importing a type defined in a file
 * created two steps later). Those ordering mistakes surface as verifier
 * failures that look like implementation bugs but are actually sequencing
 * bugs, burning correction cycles on the wrong problem.
 *
 * ── What this module provides ───────────────────────────────────────────────
 * `TaskGraph` is a dependency-ordered DAG over subtasks. It gives you:
 *   - `topologicalOrder()` — a single valid execution order respecting deps
 *   - `parallelLanes()` — groups of subtasks with no dependency between them,
 *     in dependency-depth order, so independent work can run concurrently
 *   - `budgetFor(nodeId, totalBudget)` — per-subtask budget proportional to
 *     estimated complexity and historical/assessed risk, instead of one
 *     shared budget the whole correction loop draws against undifferentiated
 *   - `fromImplementationPlan()` — a non-breaking adapter that builds a graph
 *     from the existing flat plan shape using a simple, defensible heuristic
 *     (an implementation file precedes the test file(s) that exercise it),
 *     so the new planner is a drop-in upgrade rather than a breaking change
 *     to `ImplementationPlan`'s schema.
 */

export interface TaskNode {
  readonly id: string;
  readonly description: string;
  readonly filesToTouch: string[];
  readonly dependsOn: string[];
  readonly estimatedComplexity: 'low' | 'medium' | 'high';
  /** 0–1, how likely this subtask is to fail/need correction cycles. */
  readonly riskScore: number;
}

export interface TaskGraphSpec {
  readonly nodes: TaskNode[];
}

export class CycleError extends Error {
  constructor(cyclePath: string[]) {
    super(`Cycle detected in task graph: ${cyclePath.join(' -> ')}`);
    this.name = 'CycleError';
  }
}

const COMPLEXITY_WEIGHT: Record<TaskNode['estimatedComplexity'], number> = {
  low: 1, medium: 2, high: 3,
};

export class TaskGraph {
  private readonly nodesById = new Map<string, TaskNode>();
  private readonly order: string[];

  constructor(spec: TaskGraphSpec) {
    for (const n of spec.nodes) {
      if (this.nodesById.has(n.id)) {
        throw new Error(`TaskGraph: duplicate node id "${n.id}"`);
      }
      this.nodesById.set(n.id, n);
    }
    for (const n of spec.nodes) {
      for (const dep of n.dependsOn) {
        if (!this.nodesById.has(dep)) {
          throw new Error(`TaskGraph: node "${n.id}" depends on unknown node "${dep}" — it does not exist in the graph`);
        }
      }
    }
    this.order = this.computeTopologicalOrder(); // throws CycleError if cyclic
  }

  private computeTopologicalOrder(): string[] {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const result: string[] = [];
    const stack: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (inStack.has(id)) {
        throw new CycleError([...stack, id]);
      }
      inStack.add(id);
      stack.push(id);
      const node = this.nodesById.get(id)!;
      for (const dep of [...node.dependsOn].sort()) visit(dep);
      stack.pop();
      inStack.delete(id);
      visited.add(id);
      result.push(id);
    };

    for (const id of [...this.nodesById.keys()].sort()) visit(id);
    return result;
  }

  topologicalOrder(): string[] {
    return [...this.order];
  }

  /**
   * Groups nodes into "lanes" by dependency depth: lane 0 contains all nodes
   * with no dependencies, lane 1 contains nodes whose dependencies are all in
   * lane 0 (or earlier), and so on. All nodes within a lane are mutually
   * independent and safe to execute concurrently.
   */
  parallelLanes(): string[][] {
    const depth = new Map<string, number>();
    for (const id of this.order) {
      const node = this.nodesById.get(id)!;
      const d = node.dependsOn.length === 0
        ? 0
        : Math.max(...node.dependsOn.map(dep => depth.get(dep)!)) + 1;
      depth.set(id, d);
    }
    const maxDepth = Math.max(0, ...depth.values());
    const lanes: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
    for (const id of this.order) {
      const d = depth.get(id)!;
      lanes[d]!.push(id);
    }
    return lanes;
  }

  dependenciesOf(nodeId: string): string[] {
    return [...this.requireNode(nodeId).dependsOn];
  }

  dependentsOf(nodeId: string): string[] {
    this.requireNode(nodeId);
    return [...this.nodesById.values()].filter(n => n.dependsOn.includes(nodeId)).map(n => n.id);
  }

  /** A leaf is a node nothing else depends on — i.e. a terminal output of the graph. */
  isLeaf(nodeId: string): boolean {
    return this.dependentsOf(nodeId).length === 0;
  }

  nodeFiles(nodeId: string): string[] {
    return [...this.requireNode(nodeId).filesToTouch];
  }

  riskScoreOf(nodeId: string): number {
    return this.requireNode(nodeId).riskScore;
  }

  node(nodeId: string): TaskNode {
    return this.requireNode(nodeId);
  }

  allNodeIds(): string[] {
    return [...this.order];
  }

  /**
   * Proportional budget allocation: weight = complexityWeight * (1 + riskScore).
   * A high-complexity, high-risk node can receive up to ~3x the weight of a
   * low-complexity, low-risk one, reflecting that it is more likely to need
   * additional correction cycles.
   */
  budgetFor(nodeId: string, totalBudgetUsd: number): number {
    this.requireNode(nodeId);
    const weights = new Map<string, number>();
    for (const n of this.nodesById.values()) {
      weights.set(n.id, COMPLEXITY_WEIGHT[n.estimatedComplexity] * (1 + n.riskScore));
    }
    const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return 0;
    return (totalBudgetUsd * weights.get(nodeId)!) / totalWeight;
  }

  private requireNode(nodeId: string): TaskNode {
    const n = this.nodesById.get(nodeId);
    if (!n) throw new Error(`TaskGraph: unknown node id "${nodeId}" — it does not exist in the graph`);
    return n;
  }

  /**
   * Adapter from the existing flat `ImplementationPlan` shape (kept intact —
   * no schema break) into a dependency-ordered graph. Heuristic: for each
   * created/modified non-test file, build an implementation node; for each
   * test file, build a node that depends on the implementation node(s) for
   * the source file(s) it most plausibly tests (same base name, conventional
   * `.test.`/`.spec.` suffix — the same convention `AGENTS.md` already
   * documents: "Unit test files co-located: MyService.ts -> MyService.test.ts").
   * Files in `riskyAreas` get an elevated riskScore so the budget allocator
   * gives them proportionally more correction-cycle budget.
   */
  static fromImplementationPlan(plan: {
    planSummary: string;
    filesToCreate: string[];
    filesToModify: string[];
    filesToDelete: string[];
    testFilesToCreate: string[];
    estimatedComplexity: 'low' | 'medium' | 'high';
    riskyAreas: string[];
  }): TaskGraph {
    const isTestFile = (f: string): boolean => /\.(test|spec)\.[a-z]+$/i.test(f) || plan.testFilesToCreate.includes(f);
    const sourceFiles = [...new Set([...plan.filesToCreate, ...plan.filesToModify])].filter(f => !isTestFile(f));
    const testFiles = [...new Set([...plan.filesToCreate, ...plan.testFilesToCreate])].filter(isTestFile);
    const deleteFiles = [...plan.filesToDelete];

    const riskOf = (f: string): number => (plan.riskyAreas.includes(f) ? 0.75 : 0.25);
    const baseName = (f: string): string => f.replace(/\.(test|spec)\.[a-z]+$/i, '').replace(/\.[a-z]+$/i, '');

    const nodes: TaskNode[] = [];

    for (const f of deleteFiles) {
      nodes.push({
        id: `delete:${f}`, description: `Delete ${f}`, filesToTouch: [f],
        dependsOn: [], estimatedComplexity: 'low', riskScore: riskOf(f),
      });
    }

    const implNodeIdForSource = new Map<string, string>();
    for (const f of sourceFiles) {
      const id = `impl:${f}`;
      implNodeIdForSource.set(baseName(f), id);
      nodes.push({
        id, description: `Implement ${f}`, filesToTouch: [f],
        dependsOn: [], estimatedComplexity: plan.estimatedComplexity, riskScore: riskOf(f),
      });
    }

    for (const f of testFiles) {
      const matchingImplId = implNodeIdForSource.get(baseName(f));
      nodes.push({
        id: `test:${f}`, description: `Write tests for ${f}`, filesToTouch: [f],
        dependsOn: matchingImplId ? [matchingImplId] : [],
        estimatedComplexity: 'low', riskScore: riskOf(f),
      });
    }

    if (nodes.length === 0) {
      nodes.push({
        id: 'noop', description: plan.planSummary, filesToTouch: [],
        dependsOn: [], estimatedComplexity: 'low', riskScore: 0,
      });
    }

    return new TaskGraph({ nodes });
  }
}
