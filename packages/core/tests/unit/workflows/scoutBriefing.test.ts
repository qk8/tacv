import { describe, it, expect } from 'vitest';
import { applyKnowledgeGraphBriefing, inferTaskCategory } from '../../../src/workflows/scoutBriefing.js';
import { createInitialState, type WorkflowState } from '../../../src/state/schemas.js';

const task = { taskId: 's1', description: 'Add JWT auth', mode: 'BROWNFIELD' as const, moduleType: 'ts-backend', languageIds: ['typescript'] };

describe('applyKnowledgeGraphBriefing', () => {
  it('appends the briefing under a distinct heading when agentsMdContext already has content', () => {
    const state: WorkflowState = { ...createInitialState(task), agentsMdContext: '## Conventions\nUse DI.' };
    const result = applyKnowledgeGraphBriefing(state, 'Historical failure rate: 40%.');
    expect(result.agentsMdContext).toContain('Use DI.');
    expect(result.agentsMdContext).toContain('Historical failure rate: 40%.');
  });

  it('sets agentsMdContext to the briefing alone when there was none before', () => {
    const state: WorkflowState = { ...createInitialState(task), agentsMdContext: null };
    const result = applyKnowledgeGraphBriefing(state, 'Historical failure rate: 40%.');
    expect(result.agentsMdContext).toContain('Historical failure rate: 40%.');
  });

  it('leaves state unchanged when the briefing is an empty string (no prior history case)', () => {
    const state: WorkflowState = { ...createInitialState(task), agentsMdContext: '## Conventions\nUse DI.' };
    const result = applyKnowledgeGraphBriefing(state, '');
    expect(result.agentsMdContext).toBe('## Conventions\nUse DI.');
  });

  it('does not mutate any other state field', () => {
    const state: WorkflowState = { ...createInitialState(task), cumulativeCostUsd: 5 };
    const result = applyKnowledgeGraphBriefing(state, 'briefing text');
    expect(result.cumulativeCostUsd).toBe(5);
    expect(result.task).toEqual(task);
  });
});

describe('inferTaskCategory — keys the knowledge-graph query from the task description', () => {
  it('classifies auth-related tasks', () => {
    expect(inferTaskCategory('Add JWT login flow')).toBe('auth');
    expect(inferTaskCategory('Fix authentication bug')).toBe('auth');
  });

  it('classifies caching-related tasks', () => {
    expect(inferTaskCategory('Add Redis caching layer')).toBe('caching');
  });

  it('classifies data/schema-related tasks', () => {
    expect(inferTaskCategory('Write a database migration for the orders table')).toBe('data');
  });

  it('falls back to "general" for unrecognized task descriptions', () => {
    expect(inferTaskCategory('Refactor the button component styling')).toBe('general');
  });
});
