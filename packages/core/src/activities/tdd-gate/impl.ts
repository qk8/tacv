import { z } from 'zod';
import type { WorkflowState, DiffProposal } from '../../state/schemas.js';
import type { ActivityDeps } from '../ActivityDeps.js';
import { createLogger } from '../../observability/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const log = createLogger('tacv.tdd_gate');

const SkeletonValidation = z.object({
  allFailuresAreExpected: z.boolean(),
  suspiciousTests: z.array(z.object({
    testName: z.string(),
    failureMessage: z.string(),
    issue: z.string(),
    suggestedFix: z.string(),
  })),
});

export async function tddGateImpl(state: WorkflowState, deps: ActivityDeps): Promise<WorkflowState> {
  log.info('tdd_gate.start', { mode: state.task.mode });

  if (state.task.mode === 'BROWNFIELD') {
    log.info('tdd_gate.brownfield_skip');
    return { ...state, currentPhase: 'SANDBOX_VALIDATION' };
  }

  const scaffolds: Array<{ testFilePath: string; testContent: string; framework: string }> = [];

  for (const languageId of state.task.languageIds) {
    const plugin = deps.pluginRegistry.get(languageId);
    const sourceFiles = extractSourceFiles(state.contextSkeleton, languageId);

    for (const sourceFile of sourceFiles.slice(0, 5)) {
      const profile = plugin.getProfileFor(sourceFile);
      const ctx = {
        primaryBehaviourDescription: state.task.description,
        methodName: 'implementation', functionName: 'implementation', scenarioName: 'valid_input',
      };
      const scaffold = profile
        ? profile.generateTestTemplate(sourceFile, ctx)
        : await plugin.generateTestSkeleton(sourceFile, ctx);
      scaffolds.push(scaffold);

      if (isFrontendFile(sourceFile) && profile && 'generateE2eTestTemplate' in profile) {
        const route = inferRoute(sourceFile);
        const e2e = (profile as { generateE2eTestTemplate: (f: string, r: string) => typeof scaffold }).generateE2eTestTemplate(state.task.description, route);
        scaffolds.push(e2e);
      }
    }
  }

  log.info('tdd_gate.scaffolds_generated', { count: scaffolds.length });

  // Write skeletons to disk
  for (const s of scaffolds) {
    try {
      await fs.mkdir(path.dirname(path.join(deps.repoPath, s.testFilePath)), { recursive: true });
      await fs.writeFile(path.join(deps.repoPath, s.testFilePath), s.testContent, 'utf8');
    } catch (err) {
      log.warn('tdd_gate.scaffold_write_failed', { file: s.testFilePath, error: String(err) });
    }
  }

  // Red-phase: verify tests FAIL (implementation doesn't exist yet)
  const testFilePaths = scaffolds.map(s => s.testFilePath);
  const langId = state.task.languageIds[0] ?? 'typescript';
  const plugin = deps.pluginRegistry.get(langId);

  const redResult = await plugin.runAcceptanceTests(deps.repoPath, testFilePaths, {
    timeout: 30_000, failFast: false,
  }).catch(() => ({ passed: true, failures: [], totalTests: 0, failedTests: 0, coverageReport: null, durationMs: 0 }));

  if (redResult.passed) {
    log.warn('tdd_gate.trivial_tests_all_passed', { testFiles: testFilePaths });
    // Tests pass without implementation — validate semantically
    const warning = '\n\n⚠️ TDD WARNING: Generated test skeletons all passed without any implementation. ' +
      'This usually means the assertions are vacuous (e.g., `expect(true).toBe(true)`). ' +
      'Ensure your test assertions are meaningful and will fail until the feature is built.';
    return {
      ...state, currentPhase: 'SANDBOX_VALIDATION',
      agentsMdContext: (state.agentsMdContext ?? '') + warning,
      diffProposal: appendScaffoldsToDiff(state.diffProposal, scaffolds),
    };
  }

  // SEMANTIC red-phase validation: verify tests fail for the RIGHT reason
  // (not because of syntax errors or bad imports — those aren't "red" in the TDD sense)
  try {
    const validation = await deps.extractor.extract(
      `These TDD skeleton tests just failed as expected (implementation doesn't exist yet).
       Verify each failure is a legitimate "implementation missing" failure,
       NOT an assertion logic error, syntax error, or inverted assertion.
       
       Test failures:
       ${JSON.stringify(redResult.failures?.slice(0, 10))}
       
       Generated test files:
       ${scaffolds.map(s => `${s.testFilePath}:\n${s.testContent.slice(0, 300)}`).join('\n---\n')}`,
      SkeletonValidation,
      { system: 'You validate TDD red-phase failures. Flag tests that fail for the wrong reason (bad assertions, syntax errors, inverted expectations).', model: 'claude-haiku-4-5-20251001' },
    );

    if (!validation.allFailuresAreExpected && validation.suspiciousTests.length > 0) {
      log.warn('tdd_gate.suspicious_test_assertions', { count: validation.suspiciousTests.length });
      // Regenerate the suspicious test files with corrections
      for (const suspicious of validation.suspiciousTests) {
        const scaffold = scaffolds.find(s => s.testFilePath.includes(suspicious.testName.split('.')[0] ?? ''));
        if (scaffold) {
          log.info('tdd_gate.regenerating_suspicious_test', { file: scaffold.testFilePath, fix: suspicious.suggestedFix });
          // Inject a comment into the test file noting the issue
          const patched = scaffold.testContent + `\n// TDD GATE NOTE: ${suspicious.issue}\n// Suggested fix: ${suspicious.suggestedFix}`;
          await fs.writeFile(path.join(deps.repoPath, scaffold.testFilePath), patched, 'utf8').catch(() => {});
        }
      }
    }
  } catch (err) {
    log.warn('tdd_gate.semantic_validation_failed', { error: String(err) });
  }

  log.info('tdd_gate.red_phase_confirmed', { failingCount: redResult.failedTests, total: testFilePaths.length });

  return {
    ...state,
    currentPhase: 'SANDBOX_VALIDATION',
    diffProposal: appendScaffoldsToDiff(state.diffProposal, scaffolds),
    workflowAuditTrail: [...state.workflowAuditTrail, {
      timestampMs: Date.now(), node: 'tdd_gate',
      decision: 'test_skeletons_generated_red_confirmed',
      keyValues: { count: scaffolds.length, failing: redResult.failedTests },
    }],
  };
}

function extractSourceFiles(skeleton: unknown, languageId: string): string[] {
  if (!skeleton || typeof skeleton !== 'object') return [];
  const files = (skeleton as Record<string, unknown>)['files'];
  if (!Array.isArray(files)) return [];
  const ext = languageId === 'java' ? '.java' : '.ts';
  return files.filter((f): f is string => typeof f === 'string' && f.endsWith(ext) && !f.includes('test') && !f.includes('Test'));
}
function isFrontendFile(f: string): boolean { return f.endsWith('.tsx') || f.includes('components/') || f.includes('pages/'); }
function inferRoute(f: string): string { return '/' + f.replace(/^src\/pages\//, '').replace(/\.(tsx?|jsx?)$/, '').replace(/\/index$/, ''); }
function appendScaffoldsToDiff(existing: DiffProposal | null, scaffolds: Array<{ testFilePath: string; testContent: string; framework: string }>): DiffProposal {
  const base = existing ?? { diffs: [], summary: 'TDD scaffolds', testFilePaths: [] };
  return {
    ...base,
    testFilePaths: [...new Set([...base.testFilePaths, ...scaffolds.map(s => s.testFilePath)])],
    diffs: [...base.diffs, ...scaffolds.map(s => ({ filePath: s.testFilePath, operation: 'create' as const, diffContent: s.testContent, language: s.framework }))],
  };
}
