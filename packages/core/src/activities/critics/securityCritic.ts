import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';

const SECURITY_PATTERNS: Array<{ pattern: RegExp; ruleId: string; message: string; hint: string }> = [
  { pattern: /eval\s*\(/, ruleId: 'NO_EVAL', message: 'eval() usage detected — code injection risk', hint: 'Use JSON.parse or a safer alternative.' },
  { pattern: /innerHTML\s*=/, ruleId: 'NO_INNER_HTML', message: 'innerHTML assignment — XSS risk', hint: 'Use textContent or a sanitisation library.' },
  { pattern: /password.*=.*['"]\w+['"]/, ruleId: 'HARDCODED_SECRET', message: 'Possible hardcoded password', hint: 'Use environment variables or a secrets manager.' },
  { pattern: /apiKey.*=.*['"]\w{10,}['"]/, ruleId: 'HARDCODED_API_KEY', message: 'Possible hardcoded API key', hint: 'Use environment variables or a secrets manager.' },
  { pattern: /\.query\s*\+/, ruleId: 'SQL_INJECTION', message: 'String concatenation in SQL query — injection risk', hint: 'Use parameterised queries or an ORM.' },
];

export async function securityCritic(state: WorkflowState, _deps: ActivityDeps): Promise<CriticFinding[]> {
  if (!state.diffProposal) return [];
  const findings: CriticFinding[] = [];
  for (const diff of state.diffProposal.diffs) {
    if (diff.operation === 'delete') continue;
    const lines = diff.diffContent.split('\n');
    lines.forEach((line, idx) => {
      if (!line.startsWith('+') || line.startsWith('+++')) return;
      for (const { pattern, ruleId, message, hint } of SECURITY_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({ critic: 'security', severity: 'critical', file: diff.filePath, line: idx + 1, ruleId, message, resolutionHint: hint });
        }
      }
    });
  }
  return findings;
}
