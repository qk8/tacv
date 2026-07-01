/**
 * Scout / knowledge-graph integration.
 *
 * `inferTaskCategory` derives a coarse category key from the task
 * description — the same key `KnowledgeGraphService` uses to bucket
 * failure-rate history, patterns, and negative decisions — so the Scout
 * phase can ask "what do we know about tasks like this in this repo?"
 * without requiring a human to tag every task up front. `applyKnowledgeGraphBriefing`
 * is the pure state transform that injects the resulting briefing into
 * `agentsMdContext`, where every downstream prompt builder already looks
 * for project context.
 */

import type { WorkflowState } from '../state/schemas.js';

export function applyKnowledgeGraphBriefing(state: WorkflowState, briefing: string): WorkflowState {
  if (!briefing) return state;
  const agentsMdContext = state.agentsMdContext
    ? `${state.agentsMdContext}\n\n## Organizational Knowledge (from prior sessions)\n${briefing}`
    : `## Organizational Knowledge (from prior sessions)\n${briefing}`;
  return { ...state, agentsMdContext };
}

const CATEGORY_KEYWORDS: Array<[string, RegExp]> = [
  ['auth', /\b(auth\w*|login|jwt|oauth|session|token)\b/i],
  ['caching', /\b(cache|caching|redis|memcache)\b/i],
  ['data', /\b(database|migration|schema|sql|orm|repository)\b/i],
];

export function inferTaskCategory(description: string): string {
  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(description)) return category;
  }
  return 'general';
}
