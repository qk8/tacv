/**
 * Minimal port for the organizational knowledge graph, consumed by the Scout
 * phase. Defined in `core` (alongside `IMemoryProvider`, `ISandboxProvider`,
 * etc.) rather than importing the concrete `KnowledgeGraphService` from
 * `@tacv/memory`, since `@tacv/memory` already depends on `@tacv/core` —
 * importing the other direction would create a circular package dependency.
 * `KnowledgeGraphService` satisfies this interface structurally; the
 * composition root that wires a concrete instance into `ActivityDeps` is
 * free to live wherever `@tacv/memory` is already a dependency.
 */
export interface IKnowledgeGraphProvider {
  buildScoutBriefing(repository: string, taskCategory: string): string;
}
