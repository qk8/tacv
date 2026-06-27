import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntelligentDebugger } from '../src/IntelligentDebugger.js';
import type { DebugDeps } from '../src/IntelligentDebugger.js';
import type { ILanguagePlugin, IStackParser } from '@tacv/language-plugins-base';
import type { StackFrame, ErrorType } from '@tacv/contracts';

// ── Test doubles ─────────────────────────────────────────────────────────────
const makeStackFrame = (file: string, line: number): StackFrame =>
  ({ file, line, method: 'foo', isUser: true });

function makePlugin(
  errorPatterns: Array<[RegExp[], ErrorType]> = [],
  frames: StackFrame[] = [],
): Pick<ILanguagePlugin, 'getErrorPatterns' | 'createStackParser' | 'getDebugAdapterSpec'> {
  const parser: IStackParser = { parseAndPrune: () => frames };
  return {
    getErrorPatterns:    () => errorPatterns,
    createStackParser:   () => parser,
    getDebugAdapterSpec: () => ({ protocol: 'none', defaultPort: 0, launchCmdTemplate: '' }),
  };
}

const failVerdict = (message: string) => ({
  testResult: 'FAIL' as const, diagnostic: 'AMBIGUOUS' as const,
  testFailures: [{ message }], blockedByCritic: false, confidenceScore: 0.4,
});

function makeDeps(pluginOverrides = {}): DebugDeps {
  return {
    agent: { runTask: vi.fn().mockResolvedValue({ content: 'root cause text', toolCalls: [], finishReason: 'end_turn', inputTokens: 10, outputTokens: 10, totalCostUsd: 0, callCostUsd: 0 }) },
    sandbox: {
      warmContainer:   vi.fn().mockResolvedValue({ containerId: 'c1', workingDir: '/app', hostJdwpPort: 5005, hostCdpPort: 9229 }),
      execInContainer: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
      destroyContainer: vi.fn().mockResolvedValue(undefined),
      validateImage:    vi.fn().mockResolvedValue(undefined),
    },
    pluginRegistry: {
      get: () => makePlugin([[/NullPointerException/], 'NULL_REFERENCE'] as never),
    },
    actuatorBaseUrl: 'http://localhost:8080/actuator',
    frontendBaseUrl: 'http://localhost:3000',
    ...pluginOverrides,
  } as unknown as DebugDeps;
}

const baseTask = { taskId: 't1', description: 'Fix NPE', mode: 'GREENFIELD' as const, moduleType: 'backend', languageIds: ['java'] };
const baseState = () => ({
  taskId: 't1', task: baseTask, currentPhase: 'INTELLIGENT_DEBUGGER' as const,
  workflowAuditTrail: [], cumulativeCostUsd: 0,
  verifierVerdict: null, diffProposal: null, debugObservations: null,
  contextSkeleton: null, planSkeleton: null, flakinessReport: null,
  correctionCycle: { attemptCount: 0, branchName: null, lastErrorHash: null, errorHistory: [], stagnationPattern: 'none' as const, lastOutcomeSignature: null },
});

describe('IntelligentDebugger', () => {
  it('throws when called with no failure to debug', async () => {
    const debugger_ = new IntelligentDebugger(makeDeps());
    await expect(debugger_.debug({ ...baseState(), verifierVerdict: null } as never)).rejects.toThrow();
  });

  it('throws when called with PASS verdict', async () => {
    const debugger_ = new IntelligentDebugger(makeDeps());
    const state = { ...baseState(), verifierVerdict: { testResult: 'PASS' as const, diagnostic: 'PASS' as const, testFailures: [], blockedByCritic: false, confidenceScore: 1.0 } };
    await expect(debugger_.debug(state as never)).rejects.toThrow();
  });

  it('classifies error via plugin.getErrorPatterns()', async () => {
    const plugin = makePlugin([[[/NullPointerException/], 'NULL_REFERENCE' as ErrorType]]);
    const deps = makeDeps({ pluginRegistry: { get: () => plugin } });
    const debugger_ = new IntelligentDebugger(deps);
    const state = { ...baseState(), verifierVerdict: failVerdict('java.lang.NullPointerException at UserService:45') };
    const obs = await debugger_.debug(state as never);
    expect(obs.errorType).toBe('NULL_REFERENCE');
  });

  it('uses plugin.createStackParser() to parse stack frames', async () => {
    const frames = [makeStackFrame('UserService.java', 45)];
    const plugin = makePlugin([[[/NullPointerException/], 'NULL_REFERENCE' as ErrorType]], frames);
    const deps = makeDeps({ pluginRegistry: { get: () => plugin } });
    const debugger_ = new IntelligentDebugger(deps);
    const state = { ...baseState(), verifierVerdict: failVerdict('java.lang.NullPointerException') };
    const obs = await debugger_.debug(state as never);
    expect(obs.prunedStack).toHaveLength(1);
    expect(obs.prunedStack[0]?.file).toBe('UserService.java');
  });

  it('returns log_only obs when strategy does not need live adapter', async () => {
    // STACK_OVERFLOW → log_only strategy
    const plugin = makePlugin([[[/StackOverflowError/], 'STACK_OVERFLOW' as ErrorType]]);
    const deps = makeDeps({ pluginRegistry: { get: () => plugin } });
    const debugger_ = new IntelligentDebugger(deps);
    const state = { ...baseState(), verifierVerdict: failVerdict('java.lang.StackOverflowError') };
    const obs = await debugger_.debug(state as never);
    expect(obs.errorType).toBe('STACK_OVERFLOW');
    expect(obs.breakpointHits).toHaveLength(0);
  });

  it('synthesises root cause via agent', async () => {
    const frames = [makeStackFrame('UserService.java', 45)];
    const plugin = makePlugin([[[/NullPointerException/], 'NULL_REFERENCE' as ErrorType]], frames);
    const deps = makeDeps({ pluginRegistry: { get: () => plugin } });
    const debugger_ = new IntelligentDebugger(deps);
    const state = { ...baseState(), verifierVerdict: failVerdict('NullPointerException') };
    const obs = await debugger_.debug(state as never);
    expect(obs.rootCause).toContain('root cause text');
  });

  it('cleans up sandbox container even on error', async () => {
    const destroyFn = vi.fn().mockResolvedValue(undefined);
    const plugin = makePlugin([]);
    const deps = makeDeps({ pluginRegistry: { get: () => plugin } });
    (deps.sandbox as any).destroyContainer = destroyFn;
    const debugger_ = new IntelligentDebugger(deps);
    const state = { ...baseState(), verifierVerdict: failVerdict('unknown error') };
    await debugger_.debug(state as never);
    expect(destroyFn).toHaveBeenCalled();
  });
});
