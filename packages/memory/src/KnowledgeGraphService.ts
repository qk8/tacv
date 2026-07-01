/**
 * Organizational knowledge graph.
 *
 * ── Problem this replaces ───────────────────────────────────────────────────
 * `MemoryService` (built on `IMemoryProvider` / Mem0) stores lessons and
 * human corrections as flat text blobs, retrieved by keyword overlap search.
 * It can tell you "here are 5 texts that mention similar words" but it
 * cannot answer "what fraction of auth tasks in this repository have failed,
 * and why?" — there is no aggregation, no numeric failure-rate tracking, and
 * no concept of a relationship between a failure and the convention it
 * violated. Negative knowledge ("we tried X in task 7 and reverted it")
 * has nowhere structured to live; it is just another episodic text blob,
 * indistinguishable from noise unless someone happens to search for the
 * right keywords.
 *
 * ── What this module provides ───────────────────────────────────────────────
 * A small in-process graph store — nodes (`failure`, `pattern`,
 * `negativeDecision`) plus typed edges between them — with:
 *   - `recordAttempt` / `recordFailure` / `getFailureRate` — real numeric
 *     failure-rate tracking per (repository, taskCategory), with repeated
 *     identical failures aggregated into one node with an incrementing
 *     count rather than duplicated
 *   - `recordPattern` / `queryPatterns` — durable organizational
 *     conventions, scoped per repository
 *   - `recordNegativeDecision` / `queryNegativeDecisions` — explicit
 *     negative knowledge ("don't repeat this")
 *   - `linkNodes` / `getRelatedNodes` — genuine graph traversal, e.g. linking
 *     a failure to the convention it violated
 *   - `buildScoutBriefing` — the actual integration point: synthesizes all
 *     of the above into one proactive text briefing the Scout activity can
 *     inject into context BEFORE the agent starts, instead of the agent
 *     having to rediscover the same failure mode from scratch every time
 *   - `toJSON` / `fromJSON` — a persistence round-trip, since this is meant
 *     to be a durable, cross-session, per-repository store (backed by a real
 *     database in production), unlike Mem0's per-session episodic memory
 */

export type NodeKind = 'failure' | 'pattern' | 'negativeDecision';

interface FailureNode {
  readonly id: string;
  readonly kind: 'failure';
  readonly repository: string;
  readonly taskCategory: string;
  readonly errorType: string;
  readonly rootCause: string;
  count: number;
}

interface PatternNode {
  readonly id: string;
  readonly kind: 'pattern';
  readonly repository: string;
  readonly description: string;
}

interface NegativeDecisionNode {
  readonly id: string;
  readonly kind: 'negativeDecision';
  readonly repository: string;
  readonly approach: string;
  readonly reason: string;
}

type KGNode = FailureNode | PatternNode | NegativeDecisionNode;

export type EdgeKind = 'relatesTo' | 'causes' | 'supersedes';

interface KGEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
}

export interface RelatedFailure {
  readonly id: string;
  readonly errorType: string;
  readonly rootCause: string;
  readonly count: number;
}

export interface NegativeDecisionRecord {
  readonly approach: string;
  readonly reason: string;
}

export class KnowledgeGraphService {
  private nodes = new Map<string, KGNode>();
  private edges: KGEdge[] = [];
  private attemptCounts = new Map<string, number>();
  private idCounter = 0;

  private nextId(prefix: string): string {
    return `${prefix}_${++this.idCounter}`;
  }

  private static attemptKey(repository: string, taskCategory: string): string {
    return `${repository}::${taskCategory}`;
  }

  recordAttempt(repository: string, taskCategory: string): void {
    const key = KnowledgeGraphService.attemptKey(repository, taskCategory);
    this.attemptCounts.set(key, (this.attemptCounts.get(key) ?? 0) + 1);
  }

  /** Aggregates into an existing node (same repo+category+errorType+rootCause) rather than duplicating. */
  recordFailure(repository: string, taskCategory: string, detail: { errorType: string; rootCause: string }): string {
    const existing = [...this.nodes.values()].find(
      (n): n is FailureNode => n.kind === 'failure' && n.repository === repository
        && n.taskCategory === taskCategory && n.errorType === detail.errorType && n.rootCause === detail.rootCause,
    );
    if (existing) {
      existing.count += 1;
      return existing.id;
    }
    const id = this.nextId('failure');
    this.nodes.set(id, {
      id, kind: 'failure', repository, taskCategory,
      errorType: detail.errorType, rootCause: detail.rootCause, count: 1,
    });
    return id;
  }

  getFailureRate(repository: string, taskCategory: string): number {
    const attempts = this.attemptCounts.get(KnowledgeGraphService.attemptKey(repository, taskCategory)) ?? 0;
    if (attempts === 0) return 0;
    const failures = [...this.nodes.values()]
      .filter((n): n is FailureNode => n.kind === 'failure' && n.repository === repository && n.taskCategory === taskCategory)
      .reduce((sum, n) => sum + n.count, 0);
    return failures / attempts;
  }

  queryRelatedFailures(repository: string, taskCategory: string): RelatedFailure[] {
    return [...this.nodes.values()]
      .filter((n): n is FailureNode => n.kind === 'failure' && n.repository === repository && n.taskCategory === taskCategory)
      .map(n => ({ id: n.id, errorType: n.errorType, rootCause: n.rootCause, count: n.count }))
      .sort((a, b) => b.count - a.count);
  }

  /** Convenience wrapper around `recordPatternNode` for callers that don't need the node id. */
  recordPattern(repository: string, description: string): void {
    this.recordPatternNode(repository, description);
  }

  recordPatternNode(repository: string, description: string): string {
    const id = this.nextId('pattern');
    this.nodes.set(id, { id, kind: 'pattern', repository, description });
    return id;
  }

  queryPatterns(repository: string): string[] {
    return [...this.nodes.values()]
      .filter((n): n is PatternNode => n.kind === 'pattern' && n.repository === repository)
      .map(n => n.description);
  }

  recordNegativeDecision(repository: string, approach: string, reason: string): string {
    const id = this.nextId('negdec');
    this.nodes.set(id, { id, kind: 'negativeDecision', repository, approach, reason });
    return id;
  }

  queryNegativeDecisions(repository: string): NegativeDecisionRecord[] {
    return [...this.nodes.values()]
      .filter((n): n is NegativeDecisionNode => n.kind === 'negativeDecision' && n.repository === repository)
      .map(n => ({ approach: n.approach, reason: n.reason }));
  }

  linkNodes(fromId: string, toId: string, kind: EdgeKind = 'relatesTo'): void {
    this.edges.push({ from: fromId, to: toId, kind });
  }

  getRelatedNodes(nodeId: string): KGNode[] {
    const relatedIds = this.edges
      .filter(e => e.from === nodeId || e.to === nodeId)
      .map(e => (e.from === nodeId ? e.to : e.from));
    return relatedIds.map(id => this.nodes.get(id)).filter((n): n is KGNode => n !== undefined);
  }

  /**
   * Synthesizes everything known about a (repository, taskCategory) pair into
   * one proactive briefing — the integration point for the Scout activity.
   * This is what turns organizational memory from "searchable if you know
   * what to ask" into "surfaced automatically before the agent starts."
   */
  buildScoutBriefing(repository: string, taskCategory: string): string {
    const attempts = this.attemptCounts.get(KnowledgeGraphService.attemptKey(repository, taskCategory)) ?? 0;
    const patterns = this.queryPatterns(repository);
    const negatives = this.queryNegativeDecisions(repository);
    const failures = this.queryRelatedFailures(repository, taskCategory);

    if (attempts === 0 && patterns.length === 0 && negatives.length === 0) {
      return `No prior history recorded for repository "${repository}" / category "${taskCategory}".`;
    }

    const lines: string[] = [];
    if (attempts > 0) {
      const rate = this.getFailureRate(repository, taskCategory);
      lines.push(`Historical failure rate for "${taskCategory}" tasks in this repository: ${(rate * 100).toFixed(0)}% (${attempts} prior attempt(s)).`);
      if (failures.length > 0) {
        lines.push(`Most common root cause: ${failures[0].rootCause} (${failures[0].errorType}, seen ${failures[0].count}x).`);
      }
    }
    if (patterns.length > 0) {
      lines.push(`Organizational conventions: ${patterns.join('; ')}`);
    }
    if (negatives.length > 0) {
      lines.push(`Previously reverted approaches — do not repeat: ${negatives.map(n => `"${n.approach}" (${n.reason})`).join('; ')}`);
    }
    return lines.join('\n');
  }

  toJSON(): string {
    return JSON.stringify({
      nodes: [...this.nodes.values()],
      edges: this.edges,
      attemptCounts: [...this.attemptCounts.entries()],
      idCounter: this.idCounter,
    });
  }

  static fromJSON(json: string): KnowledgeGraphService {
    const data = JSON.parse(json) as {
      nodes: KGNode[]; edges: KGEdge[]; attemptCounts: Array<[string, number]>; idCounter: number;
    };
    const kg = new KnowledgeGraphService();
    for (const n of data.nodes) kg.nodes.set(n.id, n);
    kg.edges = data.edges;
    kg.attemptCounts = new Map(data.attemptCounts);
    kg.idCounter = data.idCounter;
    return kg;
  }
}
