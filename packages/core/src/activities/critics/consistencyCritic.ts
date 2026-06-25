import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';

const INCONSISTENCY_PATTERNS: Array<{ pattern: RegExp; ruleId: string; message: string; hint: string }> = [
  { pattern: /var\s+\w+\s*=/, ruleId: 'PREFER_CONST_LET', message: 'Use const/let instead of var', hint: 'Replace var with const (or let if reassigned).' },
  { pattern: /console\.(log|warn|error)\(/, ruleId: 'NO_CONSOLE_IN_PROD', message: 'console.log/warn/error in production code', hint: 'Use the configured logger instead of console.' },
  { pattern: /\/\/\s*TODO(?!.*ticket)/i, ruleId: 'TODO_WITHOUT_TICKET', message: 'TODO comment without ticket reference', hint: 'Add a ticket reference: // TODO(PROJ-123): ...' },
  { pattern: /new Date\(\)/, ruleId: 'USE_DATE_UTILITY', message: 'Direct new Date() usage — prefer a utility for testability', hint: 'Use a DateProvider service to allow mocking in tests.' },
];

export async function consistencyCritic(state: WorkflowState, _deps: ActivityDeps): Promise<CriticFinding[]> {
  if (!state.diffProposal) return [];
  const findings: CriticFinding[] = [];

  for (const diff of state.diffProposal.diffs) {
    if (diff.operation === 'delete') continue;
    if (diff.filePath.includes('.test.') || diff.filePath.includes('.spec.')) continue;

    const lines = diff.diffContent.split('\n');
    lines.forEach((line, idx) => {
      if (!line.startsWith('+') || line.startsWith('+++')) return;
      for (const { pattern, ruleId, message, hint } of INCONSISTENCY_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({ critic: 'consistency', severity: 'warning', file: diff.filePath, line: idx + 1, ruleId, message, resolutionHint: hint });
        }
      }
    });
  }
  return findings;
}
