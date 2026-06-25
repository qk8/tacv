import { describe, it, expect } from 'vitest';
import { checkCoverageRegression } from '../../../../src/activities/verification/coverageCheck.js';

const baseline = { lines: 85, branches: 78, functions: 90, statements: 84 };
const config   = { minimumLineCoverage: 80, maxLineCoverageRegression: 2, maxBranchCoverageRegression: 2 };

describe('checkCoverageRegression', () => {
  it('passes when coverage is above minimum and not regressed', () => {
    const result = checkCoverageRegression(baseline, { ...baseline, lines: 86 }, config);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when line coverage drops below minimum', () => {
    const result = checkCoverageRegression(baseline, { ...baseline, lines: 75 }, config);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.message.includes('below minimum'))).toBe(true);
  });

  it('fails when line coverage regresses beyond threshold', () => {
    const result = checkCoverageRegression(baseline, { ...baseline, lines: 82 }, config);
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.message.includes('regressed'))).toBe(true);
  });

  it('fails when branch coverage regresses', () => {
    const result = checkCoverageRegression(baseline, { ...baseline, branches: 74 }, config);
    expect(result.passed).toBe(false);
  });

  it('passes when regression is within allowed threshold', () => {
    const result = checkCoverageRegression(baseline, { ...baseline, lines: 84 }, config);  // -1%, threshold is 2%
    expect(result.passed).toBe(true);
  });

  it('reports correct delta', () => {
    const current = { lines: 88, branches: 80, functions: 92, statements: 87 };
    const result  = checkCoverageRegression(baseline, current, config);
    expect(result.delta.lines).toBeCloseTo(3);
    expect(result.delta.branches).toBeCloseTo(2);
  });
});
