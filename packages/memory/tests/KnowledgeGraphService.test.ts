import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraphService } from '../src/KnowledgeGraphService.js';

describe('KnowledgeGraphService — failure-rate tracking (cross-session, cross-task pattern recognition)', () => {
  let kg: KnowledgeGraphService;
  beforeEach(() => { kg = new KnowledgeGraphService(); });

  it('returns 0 (not NaN) for a repository/category with no recorded history', () => {
    expect(kg.getFailureRate('repo-x', 'auth')).toBe(0);
  });

  it('computes failure rate as failures / total attempts for a (repository, taskCategory) pair', () => {
    for (let i = 0; i < 5; i++) kg.recordAttempt('repo-x', 'auth');
    for (let i = 0; i < 2; i++) kg.recordFailure('repo-x', 'auth', { errorType: 'AUTH_CONFIG', rootCause: 'missing JWT signing key' });
    expect(kg.getFailureRate('repo-x', 'auth')).toBeCloseTo(0.4, 5);
  });

  it('tracks failure rates independently per (repository, taskCategory) pair', () => {
    for (let i = 0; i < 10; i++) kg.recordAttempt('repo-x', 'auth');
    for (let i = 0; i < 1; i++) kg.recordFailure('repo-x', 'auth', { errorType: 'X', rootCause: 'x' });
    for (let i = 0; i < 10; i++) kg.recordAttempt('repo-x', 'crud');
    expect(kg.getFailureRate('repo-x', 'auth')).toBeCloseTo(0.1, 5);
    expect(kg.getFailureRate('repo-x', 'crud')).toBe(0);
  });
});

describe('KnowledgeGraphService — failure aggregation, not blind logging', () => {
  let kg: KnowledgeGraphService;
  beforeEach(() => { kg = new KnowledgeGraphService(); });

  it('aggregates repeated identical failures into one node with an incrementing count, instead of duplicating nodes', () => {
    for (let i = 0; i < 10; i++) kg.recordAttempt('repo-x', 'auth');
    for (let i = 0; i < 4; i++) kg.recordFailure('repo-x', 'auth', { errorType: 'AUTH_CONFIG', rootCause: 'missing JWT signing key' });
    const related = kg.queryRelatedFailures('repo-x', 'auth');
    expect(related).toHaveLength(1);
    expect(related[0].count).toBe(4);
  });

  it('returns related failures sorted by frequency, most common first', () => {
    for (let i = 0; i < 20; i++) kg.recordAttempt('repo-x', 'auth');
    for (let i = 0; i < 5; i++) kg.recordFailure('repo-x', 'auth', { errorType: 'AUTH_CONFIG', rootCause: 'missing JWT signing key' });
    for (let i = 0; i < 1; i++) kg.recordFailure('repo-x', 'auth', { errorType: 'TIMEOUT', rootCause: 'auth provider unreachable in sandbox' });
    const related = kg.queryRelatedFailures('repo-x', 'auth');
    expect(related[0].errorType).toBe('AUTH_CONFIG');
    expect(related[0].count).toBe(5);
    expect(related[1].errorType).toBe('TIMEOUT');
  });
});

describe('KnowledgeGraphService — organizational patterns (positive knowledge)', () => {
  let kg: KnowledgeGraphService;
  beforeEach(() => { kg = new KnowledgeGraphService(); });

  it('records and retrieves organizational conventions scoped to a repository', () => {
    kg.recordPattern('repo-x', 'Use constructor injection only — no field injection or static factories.');
    const patterns = kg.queryPatterns('repo-x');
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toContain('constructor injection');
  });

  it('does not leak patterns from one repository into another', () => {
    kg.recordPattern('repo-x', 'pattern for x');
    kg.recordPattern('repo-y', 'pattern for y');
    expect(kg.queryPatterns('repo-x')).toEqual(['pattern for x']);
  });
});

describe('KnowledgeGraphService — negative knowledge (what NOT to try again)', () => {
  let kg: KnowledgeGraphService;
  beforeEach(() => { kg = new KnowledgeGraphService(); });

  it('records a reverted approach with its reason, retrievable later', () => {
    kg.recordNegativeDecision('repo-x', 'Service mesh for internal networking', 'Reverted in task-7 due to unacceptable p99 latency increase.');
    const decisions = kg.queryNegativeDecisions('repo-x');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].approach).toContain('Service mesh');
    expect(decisions[0].reason).toContain('p99 latency');
  });
});

describe('KnowledgeGraphService — graph relationships (not just three flat lists)', () => {
  let kg: KnowledgeGraphService;
  beforeEach(() => { kg = new KnowledgeGraphService(); });

  it('links a failure node to a pattern node it relates to, and traverses the relationship', () => {
    kg.recordAttempt('repo-x', 'auth');
    const failureId = kg.recordFailure('repo-x', 'auth', { errorType: 'BEAN_CREATION_ERROR', rootCause: 'field injection used instead of constructor injection' });
    const patternId = kg.recordPatternNode('repo-x', 'Use constructor injection only.');
    kg.linkNodes(failureId, patternId, 'relatesTo');
    const related = kg.getRelatedNodes(failureId);
    expect(related.some(n => n.id === patternId)).toBe(true);
  });
});

describe('KnowledgeGraphService — Scout briefing synthesis (the actual integration point)', () => {
  let kg: KnowledgeGraphService;
  beforeEach(() => { kg = new KnowledgeGraphService(); });

  it('produces a "no prior history" briefing for an unseen repository/category rather than crashing', () => {
    const briefing = kg.buildScoutBriefing('brand-new-repo', 'auth');
    expect(briefing.toLowerCase()).toMatch(/no (prior|known|recorded) history/);
  });

  it('surfaces an elevated failure rate, the top root cause, relevant patterns, and negative decisions in one synthesized briefing', () => {
    for (let i = 0; i < 10; i++) kg.recordAttempt('repo-x', 'auth');
    for (let i = 0; i < 4; i++) kg.recordFailure('repo-x', 'auth', { errorType: 'AUTH_CONFIG', rootCause: 'missing JWT signing key configuration' });
    kg.recordPattern('repo-x', 'Use constructor injection only.');
    kg.recordNegativeDecision('repo-x', 'Custom JWT parser', 'Reverted — use the framework-provided JWT filter instead.');

    const briefing = kg.buildScoutBriefing('repo-x', 'auth');
    expect(briefing).toMatch(/40%|0\.4/);
    expect(briefing).toContain('missing JWT signing key configuration');
    expect(briefing).toContain('constructor injection');
    expect(briefing).toContain('Custom JWT parser');
  });
});

describe('KnowledgeGraphService — persistence round-trip (cross-session durability)', () => {
  it('serializes to JSON and restores an equivalent graph via fromJSON, preserving counts and relationships', () => {
    const kg = new KnowledgeGraphService();
    for (let i = 0; i < 8; i++) kg.recordAttempt('repo-x', 'auth');
    const failureId = kg.recordFailure('repo-x', 'auth', { errorType: 'AUTH_CONFIG', rootCause: 'missing key' });
    const patternId = kg.recordPatternNode('repo-x', 'pattern text');
    kg.linkNodes(failureId, patternId, 'relatesTo');

    const json = kg.toJSON();
    const restored = KnowledgeGraphService.fromJSON(json);

    expect(restored.getFailureRate('repo-x', 'auth')).toBeCloseTo(0.125, 5);
    expect(restored.getRelatedNodes(failureId).some(n => n.id === patternId)).toBe(true);
  });
});
