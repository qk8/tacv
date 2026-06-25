import type { WorkflowState, DebugObservations, ErrorType } from '@tacv/core/state';
import type { IAgentProvider, ISandboxProvider } from '@tacv/core/interfaces';
import { classifyError, selectStrategy } from './DebugStrategySelector.js';
import { StackTraceParser } from './StackTraceParser.js';
import { BreakpointStrategy } from './strategies/BreakpointStrategy.js';
import { ActuatorQueryStrategy } from './strategies/ActuatorQueryStrategy.js';
import { DeltaDebugStrategy } from './strategies/DeltaDebugStrategy.js';
import { PlaywrightDebugAdapter } from './adapters/PlaywrightDebugAdapter.js';
import { createLogger } from '@tacv/core/observability';

const log = createLogger('tacv.intelligent_debugger');

const ROOT_CAUSE_PROMPT = `You are a debugging analyst. Given structured debug observations from a live debug session, write ONE concise paragraph identifying the root cause. Be specific: name the exact file, line, variable name, and the value that caused the problem. Do not use bullet points or markdown. One paragraph only.`;

export interface DebugDeps {
  agent:         IAgentProvider;
  sandbox:       ISandboxProvider;
  getDebugAdapter: (langId: string) => import('@tacv/core/interfaces').IDebugAdapter | null;
  getLaunchConfig: (langId: string, repoPath: string) => import('./strategies/BreakpointStrategy.js').DebugLaunchConfig | null;
  actuatorBaseUrl: string;
  frontendBaseUrl: string;
  userJavaPackage: string;
  userTsSrcRoot:   string;
}

export class IntelligentDebugger {
  constructor(private readonly deps: DebugDeps) {}

  async debug(state: WorkflowState): Promise<DebugObservations> {
    const verdict  = state.verifierVerdict;
    if (!verdict || verdict.testResult === 'PASS') {
      throw new Error('IntelligentDebugger called with no failure to debug');
    }

    const rawOutput = verdict.testFailures.map(f => f.message).join('\n');
    const langId    = state.task.languageIds[0] ?? 'typescript';
    const errorType = classifyError(rawOutput, langId);
    const strategy  = selectStrategy(errorType, langId);

    const parser = new StackTraceParser(langId, this.deps.userJavaPackage, this.deps.userTsSrcRoot);
    const frames = parser.parseAndPrune(rawOutput, state.task.moduleType);

    log.info('debugger.start', { errorType, strategy: strategy.tool, frames: frames.length, langId });

    let obs: DebugObservations = {
      errorType,
      rootCause:           '',
      breakpointHits:      [],
      actuatorBeans:       null,
      actuatorEnv:         null,
      minimalPayload:      null,
      playwrightTracePath: null,
      prunedStack:         frames,
    };

    const handle = await this.deps.sandbox.warmContainer();
    try {
      switch (strategy.tool) {
        case 'actuator': {
          const s = new ActuatorQueryStrategy(this.deps.sandbox);
          obs = await s.execute(obs, handle, this.deps.actuatorBaseUrl);
          break;
        }
        case 'delta_debug': {
          const s = new DeltaDebugStrategy(this.deps.sandbox);
          obs = await s.execute(obs, state, handle, state.task.moduleType);
          break;
        }
        case 'breakpoint': {
          const adapter      = this.deps.getDebugAdapter(langId);
          const launchConfig = this.deps.getLaunchConfig(langId, state.task.moduleType);
          if (adapter && launchConfig && frames.length > 0) {
            const s = new BreakpointStrategy(this.deps.sandbox, adapter);
            obs = await s.execute(obs, frames, strategy, handle, launchConfig);
          } else {
            log.warn('debugger.breakpoint_skip', { hasAdapter: !!adapter, hasLaunch: !!launchConfig, frames: frames.length });
          }
          break;
        }
        case 'playwright': {
          const pw = new PlaywrightDebugAdapter();
          obs = await pw.captureReactState(obs, handle, this.deps.sandbox, this.deps.frontendBaseUrl);
          break;
        }
        case 'log_only':
          log.info('debugger.log_only', { errorType, hint: strategy.focusHint });
          break;
      }

      obs = { ...obs, rootCause: await this._synthesiseRootCause(obs, state) };
    } finally {
      await this.deps.sandbox.destroyContainer(handle);
    }

    log.info('debugger.complete', { errorType, rootCauseLen: obs.rootCause.length, hits: obs.breakpointHits.length });
    return obs;
  }

  private async _synthesiseRootCause(obs: DebugObservations, state: WorkflowState): Promise<string> {
    const hasData = obs.breakpointHits.length > 0 || obs.actuatorBeans !== null || obs.minimalPayload !== null;
    if (!hasData && obs.prunedStack.length === 0) {
      return `(no debug observations available — error type: ${obs.errorType})`;
    }

    const summary = {
      errorType:     obs.errorType,
      prunedStack:   obs.prunedStack.slice(0, 5),
      breakpoints:   obs.breakpointHits.slice(0, 2).map(h => ({ file: h.file, line: h.line, vars: Object.entries(h.variables).slice(0, 5) })),
      actuatorBeans: obs.actuatorBeans !== null,
      minimalPayload: obs.minimalPayload,
    };

    try {
      const result = await this.deps.agent.runTask(
        `Task: ${state.task.description}\n\nDebug observations:\n${JSON.stringify(summary, null, 2)}\n\nTest failures:\n${state.verifierVerdict?.testFailures.slice(0, 3).map(f => `- ${f.message}`).join('\n') ?? '(none)'}`,
        {},
        { role: 'debug_analyst', systemPrompt: ROOT_CAUSE_PROMPT, maxTurns: 1, allowedTools: [], promptVersion: '2026-06-01-v1' },
        0,
      );
      return result.content.trim().slice(0, 600);
    } catch (err) {
      log.warn('debugger.synthesis_failed', { error: String(err) });
      return `(root cause synthesis unavailable — error type: ${obs.errorType})`;
    }
  }
}
