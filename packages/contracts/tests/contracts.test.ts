import { describe, it, expect } from 'vitest';
import { ALL_ERROR_TYPES } from '../src/index.js';
import type {
  TestResult, TestFailure, ApiTestResult, MutationResult,
  AstDiffResult, SemanticChange, CoverageReport,
  BreakpointHit, DebugObservations,
  ErrorType,
  IDebugAdapter, BreakpointLocation, VariableInfo, DebugLaunchConfig,
} from '../src/index.js';

// ── Type-level tests (these fail at compile time if types are wrong) ─────────
describe('@tacv/contracts — type shapes', () => {
  it('TestResult has required fields', () => {
    const r: TestResult = {
      passed: true, totalTests: 10, failedTests: 0,
      failures: [], coverageReport: null, durationMs: 42,
    };
    expect(r.passed).toBe(true);
  });

  it('TestFailure allows optional file + line', () => {
    const f: TestFailure = { testName: 'my test', message: 'oops' };
    expect(f.testName).toBe('my test');
    const f2: TestFailure = { testName: 't', message: 'm', file: 'foo.ts', line: 5 };
    expect(f2.line).toBe(5);
  });

  it('ApiTestResult has endpoint + method + status fields', () => {
    const a: ApiTestResult = {
      passed: false, totalTests: 1, failedTests: 1,
      failures: [{ testName: 'POST /users', endpoint: '/users', method: 'POST', expectedStatus: 201, actualStatus: 500, message: 'server error' }],
      durationMs: 100,
    };
    expect(a.failures[0]?.endpoint).toBe('/users');
  });

  it('MutationResult has score + mutant counts', () => {
    const m: MutationResult = { mutationScore: 75, totalMutants: 100, killedMutants: 75, survivedMutants: 25, weakTestFiles: [], durationMs: 5000 };
    expect(m.mutationScore).toBe(75);
  });

  it('AstDiffResult has semantic changes + counts', () => {
    const r: AstDiffResult = { semanticChanges: [], breakingChangeCount: 0, safeChangeCount: 0 };
    expect(r.semanticChanges).toHaveLength(0);
  });

  it('SemanticChange breakingRisk values', () => {
    const c: SemanticChange = { file: 'foo.ts', kind: 'method_removed', symbolName: 'foo', description: 'removed', breakingRisk: 'high' };
    expect(c.breakingRisk).toBe('high');
  });

  it('CoverageReport has lines + branches', () => {
    const c: CoverageReport = { lines: 85.5, branches: 70.0, functions: 90.0, statements: 85.0 };
    expect(c.lines).toBe(85.5);
  });

  it('BreakpointHit has variables + callStack', () => {
    const h: BreakpointHit = { file: 'Service.java', line: 42, variables: { x: { value: 1, type: 'int' } }, callStack: ['at foo()'], threadId: '1' };
    expect(h.line).toBe(42);
    expect(h.variables['x']?.type).toBe('int');
  });

  it('DebugObservations nullable fields', () => {
    const obs: DebugObservations = {
      errorType: 'NULL_REFERENCE', rootCause: 'x was null',
      breakpointHits: [], actuatorBeans: null, actuatorEnv: null,
      minimalPayload: null, playwrightTracePath: null, prunedStack: [],
    };
    expect(obs.actuatorBeans).toBeNull();
  });

  it('ALL_ERROR_TYPES includes expected members', () => {
    const types: readonly string[] = ALL_ERROR_TYPES;
    expect(types).toContain('NULL_REFERENCE');
    expect(types).toContain('BEAN_CREATION_ERROR');
    expect(types).toContain('REACT_STATE_MISMATCH');
    expect(types).toContain('UNKNOWN');
  });

  it('DebugLaunchConfig has type + launchCmd + debugPort', () => {
    const cfg: DebugLaunchConfig = { type: 'jdwp', launchCmd: 'mvn test', cwd: '.', debugPort: 5005 };
    expect(cfg.debugPort).toBe(5005);
  });

  it('BreakpointLocation has file + line', () => {
    const loc: BreakpointLocation = { file: 'Foo.java', line: 10 };
    expect(loc.file).toBe('Foo.java');
  });
});

describe('@tacv/contracts — provider interfaces', () => {
  it('SandboxHandle has containerId, workingDir, ports', () => {
    const h: import('../src/index.js').SandboxHandle = {
      containerId: 'c1', workingDir: '/app',
      hostJdwpPort: 5005, hostCdpPort: 9229,
    };
    expect(h.containerId).toBe('c1');
    expect(h.hostJdwpPort).toBe(5005);
  });

  it('ExecResult has stdout, stderr, exitCode', () => {
    const r: import('../src/index.js').ExecResult = { stdout: 'ok', stderr: '', exitCode: 0 };
    expect(r.exitCode).toBe(0);
  });

  it('AgentResult has content and cost fields', () => {
    const r: import('../src/index.js').AgentResult = {
      content: 'done', toolCalls: [], finishReason: 'end_turn',
      inputTokens: 10, outputTokens: 20, totalCostUsd: 0.001, callCostUsd: 0.001,
    };
    expect(r.content).toBe('done');
  });
});
