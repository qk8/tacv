import { describe, it, expect } from 'vitest';
import { assessConfidenceTrajectory, predictsStagnation, type CycleSnapshot } from '../../../../src/activities/stagnation/trajectory.js';

const snap = (cycle: number, failingTestCount: number): CycleSnapshot => ({ cycle, failingTestCount });

describe('assessConfidenceTrajectory', () => {
  it('returns insufficient_data with 0 or 1 data points', () => {
    expect(assessConfidenceTrajectory([])).toBe('insufficient_data');
    expect(assessConfidenceTrajectory([snap(1, 10)])).toBe('insufficient_data');
  });

  it('classifies a steadily decreasing failing-test count as improving', () => {
    expect(assessConfidenceTrajectory([snap(1, 10), snap(2, 6), snap(3, 2)])).toBe('improving');
  });

  it('classifies an unchanged failing-test count across cycles as flat', () => {
    expect(assessConfidenceTrajectory([snap(1, 10), snap(2, 10), snap(3, 10)])).toBe('flat');
  });

  it('classifies a steadily increasing failing-test count as worsening', () => {
    expect(assessConfidenceTrajectory([snap(1, 5), snap(2, 8), snap(3, 12)])).toBe('worsening');
  });

  it('classifies a mixed-but-net-decreasing sequence as improving (judges the trend, not just the last step)', () => {
    expect(assessConfidenceTrajectory([snap(1, 10), snap(2, 6), snap(3, 7)])).toBe('improving');
  });
});

describe('predictsStagnation — proactive signal distinct from reactive Jaccard text-similarity detection', () => {
  it('does not predict stagnation while genuinely improving', () => {
    expect(predictsStagnation([snap(1, 10), snap(2, 6), snap(3, 2)])).toBe(false);
  });

  it('predicts stagnation once progress plateaus, even though each cycle\'s specific failing tests differ in name/message (a case pure error-text similarity could miss entirely)', () => {
    // Progress plateaus at 4 failing tests for cycles 3-4, even though the
    // *identity* of which tests are failing is different each time — a
    // text-similarity comparison of error messages would see no repeated
    // string and might not flag stagnation, but the count tells the truth.
    const history = [snap(1, 10), snap(2, 4), snap(3, 4), snap(4, 4)];
    expect(predictsStagnation(history)).toBe(true);
  });

  it('predicts stagnation when the failing count is trending worse', () => {
    expect(predictsStagnation([snap(1, 3), snap(2, 5), snap(3, 9)])).toBe(true);
  });

  it('returns false for insufficient data rather than a false positive', () => {
    expect(predictsStagnation([snap(1, 10)])).toBe(false);
  });

  it('demonstrates a complete progression: detects the shift from improving to plateaued as more cycles accumulate', () => {
    const upToCycle2 = [snap(1, 10), snap(2, 6)];
    expect(predictsStagnation(upToCycle2)).toBe(false);

    const upToCycle4 = [...upToCycle2, snap(3, 6), snap(4, 6)];
    expect(predictsStagnation(upToCycle4)).toBe(true);
  });
});
