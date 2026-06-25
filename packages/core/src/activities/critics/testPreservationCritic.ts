import type { WorkflowState, CriticFinding } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';

export function isTestFile(filePath: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(filePath) ||
    filePath.includes('__tests__') ||
    filePath.endsWith('Test.java') ||
    filePath.endsWith('IT.java');
}

export interface WeakenedAssertion { line: number; before: string; after: string }

export function detectWeakenedAssertions(diffContent: string): WeakenedAssertion[] {
  const weakened: WeakenedAssertion[] = [];
  const lines = diffContent.split('\n');
  const WEAKENING_PAIRS = [
    { strong: /\.toBe\(/, weak: /\.toBeTruthy\(|\.toBeDefined\(/ },
    { strong: /assertEquals\([^,]+,/, weak: /assertNotNull\(/ },
    { strong: /verify\(.*times\(\d+\)/, weak: /verify\(.*atLeastOnce\(/ },
    { strong: /\.toEqual\(/, weak: /\.toBeTruthy\(/ },
  ];
  for (let i = 0; i < lines.length - 1; i++) {
    const removed = lines[i] ?? '';
    const added   = lines[i + 1] ?? '';
    if (!removed.startsWith('-') || !added.startsWith('+')) continue;
    for (const { strong, weak } of WEAKENING_PAIRS) {
      if (strong.test(removed) && weak.test(added)) {
        weakened.push({ line: i + 1, before: removed.slice(1).trim(), after: added.slice(1).trim() });
      }
    }
  }
  return weakened;
}

export async function testPreservationCritic(state: WorkflowState, deps: ActivityDeps): Promise<CriticFinding[]> {
  if (!state.diffProposal) return [];
  const findings: CriticFinding[] = [];

  for (const diff of state.diffProposal.diffs) {
    if (diff.operation !== 'modify' && diff.operation !== 'delete') continue;

    if (diff.operation === 'delete' && isTestFile(diff.filePath)) {
      findings.push({ critic: 'test_preservation', severity: 'critical', file: diff.filePath, line: null, ruleId: 'NO_DELETE_TEST_FILE', message: `Entire test file deleted: ${diff.filePath}`, resolutionHint: 'Test files must never be deleted. Fix the implementation to make the test pass.' });
      continue;
    }

    if (!isTestFile(diff.filePath)) continue;

    const plugin = deps.pluginRegistry.getForFile(diff.filePath);
    if (plugin) {
      const deleted = plugin.detectDeletedTests(diff.diffContent);
      for (const name of deleted) {
        findings.push({ critic: 'test_preservation', severity: 'critical', file: diff.filePath, line: null, ruleId: 'NO_DELETE_TESTS', message: `Test '${name}' was deleted. Tests are permanent artifacts.`, resolutionHint: "Fix the implementation. Mark as @Disabled/@skip with a comment if obsolete — never delete." });
      }
    }

    const weakened = detectWeakenedAssertions(diff.diffContent);
    for (const w of weakened) {
      findings.push({ critic: 'consistency', severity: 'warning', file: diff.filePath, line: w.line, ruleId: 'NO_WEAKEN_ASSERTIONS', message: `Assertion weakened: '${w.before}' → '${w.after}'`, resolutionHint: 'Strengthen the implementation to satisfy the original assertion.' });
    }
  }
  return findings;
}
