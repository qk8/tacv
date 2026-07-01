import { describe, it, expect } from 'vitest';
import {
  trackConsecutiveStagnation, computeLadderDecision, buildEnrichmentNote,
} from '../../../../src/activities/stagnation/ladder.js';

describe('trackConsecutiveStagnation', () => {
  it('resets the counter to 0 when the current pattern is "none"', () => {
    expect(trackConsecutiveStagnation(3, 'none')).toBe(0);
  });

  it('increments the counter by 1 when stagnation is detected again', () => {
    expect(trackConsecutiveStagnation(0, 'iteration')).toBe(1);
    expect(trackConsecutiveStagnation(1, 'semantic')).toBe(2);
    expect(trackConsecutiveStagnation(2, 'outcome')).toBe(3);
  });

  it('keeps incrementing regardless of which stagnation pattern fires (the ladder cares about consecutive count, not pattern type)', () => {
    let count = 0;
    for (const pattern of ['iteration', 'semantic', 'outcome', 'iteration'] as const) {
      count = trackConsecutiveStagnation(count, pattern);
    }
    expect(count).toBe(4);
  });
});

describe('computeLadderDecision — graduated response instead of binary stagnation -> HITL', () => {
  it('level 0 (no stagnation yet): no special action, proceed normally', () => {
    const d = computeLadderDecision(0);
    expect(d.level).toBe(0);
    expect(d.action).toBe('none');
  });

  it('level 1 (first stagnation): enrich the prompt with tried-approaches context — no expensive escalation yet', () => {
    const d = computeLadderDecision(1);
    expect(d.level).toBe(1);
    expect(d.action).toBe('enrich_prompt');
  });

  it('level 2 (second consecutive stagnation): auto-engage the intelligent debugger', () => {
    const d = computeLadderDecision(2);
    expect(d.level).toBe(2);
    expect(d.action).toBe('auto_debug');
  });

  it('level 3 (third consecutive stagnation): trigger speculative branching', () => {
    const d = computeLadderDecision(3);
    expect(d.level).toBe(3);
    expect(d.action).toBe('speculative_branch');
  });

  it('level 4 (fourth consecutive stagnation): targeted HITL with specific generated questions', () => {
    const d = computeLadderDecision(4);
    expect(d.level).toBe(4);
    expect(d.action).toBe('targeted_hitl');
  });

  it('level 5+ (fifth or more consecutive stagnation): full escalation', () => {
    expect(computeLadderDecision(5).action).toBe('full_escalation');
  });

  it('saturates at full_escalation rather than growing unboundedly past level 5', () => {
    expect(computeLadderDecision(8).action).toBe('full_escalation');
    expect(computeLadderDecision(100).level).toBe(5);
  });

  it('every decision carries a human-readable reason string usable in the audit trail', () => {
    for (let n = 0; n <= 5; n++) {
      expect(computeLadderDecision(n).reason.length).toBeGreaterThan(0);
    }
  });

  it('rejects a negative count', () => {
    expect(() => computeLadderDecision(-1)).toThrow();
  });
});

describe('buildEnrichmentNote — level-1 response: explicit tried-approaches context', () => {
  it('returns an empty-ish note when nothing has been tried yet', () => {
    expect(buildEnrichmentNote([])).toContain('No prior approaches recorded');
  });

  it('lists each tried approach explicitly so the agent can distinguish "tried and failed" from "never tried"', () => {
    const note = buildEnrichmentNote(['JWT with HS256 + env secret', 'JWT with RS256 + static key file']);
    expect(note).toContain('JWT with HS256 + env secret');
    expect(note).toContain('JWT with RS256 + static key file');
  });

  it('explicitly instructs the agent to try something fundamentally different', () => {
    const note = buildEnrichmentNote(['approach A']);
    expect(note.toLowerCase()).toMatch(/different|distinct|new approach/);
  });
});
