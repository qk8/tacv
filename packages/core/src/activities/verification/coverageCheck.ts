export interface CoverageReport {
  lines:      number;
  branches:   number;
  functions:  number;
  statements: number;
}

export interface CoverageCheckResult {
  passed:     boolean;
  violations: Array<{ message: string }>;
  delta: { lines: number; branches: number; functions: number; statements: number };
}

export interface CoverageConfig {
  minimumLineCoverage:         number;
  maxLineCoverageRegression:   number;
  maxBranchCoverageRegression: number;
}

export function checkCoverageRegression(
  baseline: CoverageReport,
  current:  CoverageReport,
  config:   CoverageConfig,
): CoverageCheckResult {
  const delta = {
    lines:      current.lines      - baseline.lines,
    branches:   current.branches   - baseline.branches,
    functions:  current.functions  - baseline.functions,
    statements: current.statements - baseline.statements,
  };

  const violations: Array<{ message: string }> = [];

  if (current.lines < config.minimumLineCoverage) {
    violations.push({ message: `Line coverage ${current.lines.toFixed(1)}% is below minimum ${config.minimumLineCoverage}%` });
  }
  if (delta.lines < -config.maxLineCoverageRegression) {
    violations.push({ message: `Line coverage regressed by ${Math.abs(delta.lines).toFixed(1)}% (max allowed: ${config.maxLineCoverageRegression}%)` });
  }
  if (delta.branches < -config.maxBranchCoverageRegression) {
    violations.push({ message: `Branch coverage regressed by ${Math.abs(delta.branches).toFixed(1)}% (max allowed: ${config.maxBranchCoverageRegression}%)` });
  }

  return { passed: violations.length === 0, violations, delta };
}
