import { describe, it, expect } from 'vitest';
import { synthesizeFindings, formatRootCausesForActor } from '../../../../src/activities/critics/synthesis.js';
import type { CriticFinding } from '../../../../src/state/schemas.js';

function finding(partial: Partial<CriticFinding> & Pick<CriticFinding, 'critic' | 'file' | 'message'>): CriticFinding {
  return {
    severity: 'warning', line: null, ruleId: 'GENERIC', resolutionHint: 'Fix it',
    ...partial,
  };
}

describe('synthesizeFindings — root-cause grouping', () => {
  it('returns an empty array for no findings', () => {
    expect(synthesizeFindings([])).toEqual([]);
  });

  it('keeps a single finding as its own single-finding group', () => {
    const groups = synthesizeFindings([
      finding({ critic: 'security', file: 'src/a.ts', message: 'SQL injection risk', severity: 'critical' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].findings).toHaveLength(1);
    expect(groups[0].maxSeverity).toBe('critical');
  });

  it('compresses multiple findings on the SAME file from DIFFERENT critics into one root-cause group', () => {
    const groups = synthesizeFindings([
      finding({ critic: 'security', file: 'src/UserRepo.ts', message: 'Raw SQL concatenation', ruleId: 'SQL_INJECTION', severity: 'critical' }),
      finding({ critic: 'architecture', file: 'src/UserRepo.ts', message: 'Data layer bypasses repository abstraction', ruleId: 'LAYER_VIOLATION', severity: 'warning' }),
      finding({ critic: 'style', file: 'src/UserRepo.ts', message: 'Inconsistent query formatting', ruleId: 'STYLE_QUERY', severity: 'info' }),
    ]);
    // 3 findings compress into 1 group — this is the headline compression property.
    expect(groups).toHaveLength(1);
    expect(groups[0].findings).toHaveLength(3);
    expect(groups[0].affectedFiles).toEqual(['src/UserRepo.ts']);
  });

  it('does NOT merge findings from different, unrelated files (no false compression)', () => {
    const groups = synthesizeFindings([
      finding({ critic: 'security', file: 'src/a.ts', message: 'issue a' }),
      finding({ critic: 'style', file: 'src/b.ts', message: 'issue b' }),
      finding({ critic: 'performance', file: 'src/c.ts', message: 'issue c' }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it('sets group maxSeverity to the highest severity among its findings (critical > warning > info)', () => {
    const groups = synthesizeFindings([
      finding({ critic: 'style', file: 'src/x.ts', message: 'minor', severity: 'info' }),
      finding({ critic: 'security', file: 'src/x.ts', message: 'major', severity: 'critical' }),
    ]);
    expect(groups[0].maxSeverity).toBe('critical');
  });

  it('sorts groups with the highest-severity root cause first', () => {
    const groups = synthesizeFindings([
      finding({ critic: 'style', file: 'src/low.ts', message: 'cosmetic', severity: 'info' }),
      finding({ critic: 'security', file: 'src/high.ts', message: 'dangerous', severity: 'critical' }),
      finding({ critic: 'performance', file: 'src/mid.ts', message: 'slow', severity: 'warning' }),
    ]);
    expect(groups.map(g => g.affectedFiles[0])).toEqual(['src/high.ts', 'src/mid.ts', 'src/low.ts']);
  });

  it('deduplicates an identical resolutionHint repeated across critics instead of repeating it verbatim', () => {
    const groups = synthesizeFindings([
      finding({ critic: 'security', file: 'src/y.ts', message: 'm1', resolutionHint: 'Use parameterized queries' }),
      finding({ critic: 'architecture', file: 'src/y.ts', message: 'm2', resolutionHint: 'Use parameterized queries' }),
    ]);
    expect(groups[0].resolutionHint).toBe('Use parameterized queries');
  });

  it('joins distinct resolutionHints when critics genuinely disagree on the fix', () => {
    const groups = synthesizeFindings([
      finding({ critic: 'security', file: 'src/z.ts', message: 'm1', resolutionHint: 'Use parameterized queries' }),
      finding({ critic: 'performance', file: 'src/z.ts', message: 'm2', resolutionHint: 'Add a query cache' }),
    ]);
    expect(groups[0].resolutionHint).toContain('parameterized queries');
    expect(groups[0].resolutionHint).toContain('query cache');
  });

  it('lists the distinct critics that contributed to a group in the title', () => {
    const groups = synthesizeFindings([
      finding({ critic: 'security', file: 'src/w.ts', message: 'm1' }),
      finding({ critic: 'architecture', file: 'src/w.ts', message: 'm2' }),
    ]);
    expect(groups[0].title).toMatch(/security/);
    expect(groups[0].title).toMatch(/architecture/);
  });
});

describe('formatRootCausesForActor — actor-facing compression', () => {
  it('produces a string shorter than dumping every raw finding when there is real overlap', () => {
    const findings: CriticFinding[] = [
      finding({ critic: 'security', file: 'src/UserRepo.ts', message: 'Raw SQL concatenation found in query builder', ruleId: 'SQL_INJECTION', severity: 'critical', resolutionHint: 'Use parameterized queries throughout the repository layer' }),
      finding({ critic: 'architecture', file: 'src/UserRepo.ts', message: 'Data layer bypasses repository abstraction boundary', ruleId: 'LAYER_VIOLATION', severity: 'warning', resolutionHint: 'Use parameterized queries throughout the repository layer' }),
      finding({ critic: 'dependency_vuln', file: 'src/UserRepo.ts', message: 'Query builder pattern matches known-vulnerable usage', ruleId: 'DEP_PATTERN', severity: 'warning', resolutionHint: 'Use parameterized queries throughout the repository layer' }),
    ];
    const groups = synthesizeFindings(findings);
    const rawDump = findings.map(f => `${f.critic}: ${f.message} (${f.resolutionHint})`).join('\n');
    const synthesized = formatRootCausesForActor(groups);
    expect(synthesized.length).toBeLessThan(rawDump.length);
  });

  it('caps the number of root causes shown to maxGroups, prioritizing severity', () => {
    const findings: CriticFinding[] = Array.from({ length: 10 }, (_, i) =>
      finding({ critic: 'style', file: `src/file${i}.ts`, message: `issue ${i}`, severity: i === 0 ? 'critical' : 'info' }));
    const text = formatRootCausesForActor(synthesizeFindings(findings), 3);
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(text).toContain('file0.ts'); // the critical one must survive the cap
  });

  it('returns an empty string when there are no findings', () => {
    expect(formatRootCausesForActor([])).toBe('');
  });
});
