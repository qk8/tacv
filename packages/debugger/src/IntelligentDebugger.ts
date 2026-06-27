import type { WorkflowState, DebugObservations, ErrorType,
              IAgentProvider, ISandboxProvider } from '@tacv/contracts';
import type { ILanguagePlugin }          from '@tacv/language-plugins-base';
import { classifyErrorWithPlugin, selectStrategy } from './DebugStrategySelector.js';
import { StackTraceParser }              from './StackTraceParser.js';
import { createDebugAdapter, buildLaunchCmd } from './DebugAdapterFactory.js';
import { BreakpointStrategy }           from './strategies/BreakpointStrategy.js';
import { ActuatorQueryStrategy }        from './strategies/ActuatorQueryStrategy.js';
import { DeltaDebugStrategy }           from './strategies/DeltaDebugStrategy.js';
import { PlaywrightDebugAdapter }       from './adapters/PlaywrightDebugAdapter.js';
import { createLogger }                 from '@tacv/core/observability';

const log = createLogger('tacv.intelligent_debugger');

const ROOT_CAUSE_PROMPT =
  `You are a debugging analyst. Given structured debug observations from a live debug ` +
  `session, write ONE concise paragraph identifying the root cause. Be specific: name ` +
  `the exact file, line, variable name, and the value that caused the problem. Do not ` +
  `use bullet points or markdown. One paragraph only.`;

/**
 * Minimal plugin surface the debugger needs.
 * Using a structural subset keeps the debugger decoupled from the full ILanguagePlugin.
 */
export type DebugPlugin = Pick<
  ILanguagePlugin,
  'getErrorPatterns' | 'createStackParser' | 'getDebugAdapterSpec'
>;

/**
 * Registry interface required by IntelligentDebugger.
 * Matches the LanguagePluginRegistry shape without importing it directly.
 */
export interface DebugPluginRegistry {
  get(languageId: string): DebugPlugin;
}

export interface DebugDeps {
  readonly agent:          IAgentProvider;
  readonly sandbox:        ISandboxProvider;
  /** Plugin registry — provides per-language error patterns, stack parsing, and adapter spec. */
  readonly pluginRegistry: DebugPluginRegistry;
  readonly actuatorBaseUrl: string;
  readonly frontendBaseUrl: string;
}

export class IntelligentDebugger {
  constructor(private readonly deps: DebugDeps) {}

  async debug(state: WorkflowState): Promise<DebugObservations> {
    const verdict = state.verifierVerdict;
    if (!verdict || verdict.testResult === 'PASS') {
      throw new Error('IntelligentDebugger.debug() called with no failure to analyse');
    }

    const rawOutput = verdict.testFailures.map(f => f.message).join('\n');
    const langId    = state.task.languageIds[0] ?? 'typescript';

    // ── Resolve plugin — owns all language-specific knowledge ────────────────
    const plugin    = this.deps.pluginRegistry.get(langId);

    // ★ classifyErrorWithPlugin: no hardcoded pattern tables, delegates to plugin
    const errorType = classifyErrorWithPlugin(rawOutput, plugin);
    const strategy  = selectStrategy(errorType, langId);

    // ★ plugin.createStackParser(): no more langId string dispatch in StackTraceParser
    const parser = new StackTraceParser(plugin.createStackParser());
    const frames = parser.parseAndPrune(rawOutput, state.task.moduleType);

    log.info('debugger.start', {
      errorType, strategy: strategy.tool,
      frames: frames.length, langId,
    });

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
          // ★ Pull defaultApiPort from the plugin spec instead of moduleType string match
          const spec    = plugin.getDebugAdapterSpec?.();
          const apiPort = spec?.protocol === 'none' ? 3000 : (spec?.defaultPort ?? 3000);
          const s = new DeltaDebugStrategy(this.deps.sandbox, apiPort);
          obs = await s.execute(obs, state, handle, state.task.moduleType);
          break;
        }

        case 'breakpoint': {
          // ★ Use DebugAdapterFactory.createDebugAdapter(spec) — no more fake stubs
          const spec = plugin.getDebugAdapterSpec?.();
          if (spec && spec.protocol !== 'none' && frames.length > 0) {
            const adapter = createDebugAdapter(spec);
            if (adapter) {
              const launchConfig = {
                type:      spec.protocol,
                launchCmd: buildLaunchCmd(spec),
                cwd:       '.',
                debugPort: spec.defaultPort,
              };
              const s = new BreakpointStrategy(this.deps.sandbox, adapter);
              obs = await s.execute(obs, frames, strategy, handle, launchConfig);
            }
          } else {
            log.warn('debugger.breakpoint_skip', {
              hasSpec: !!spec, protocol: spec?.protocol,
              frames: frames.length,
            });
          }
          break;
        }

        case 'playwright': {
          const pw = new PlaywrightDebugAdapter();
          obs = await pw.captureReactState(
            obs, handle, this.deps.sandbox, this.deps.frontendBaseUrl,
          );
          break;
        }

        case 'log_only':
          log.info('debugger.log_only', {
            errorType, hint: strategy.focusHint,
          });
          break;
      }

      obs = { ...obs, rootCause: await this._synthesiseRootCause(obs, state) };
    } finally {
      await this.deps.sandbox.destroyContainer(handle);
    }

    log.info('debugger.complete', {
      errorType, rootCauseLen: obs.rootCause.length,
      hits: obs.breakpointHits.length,
    });
    return obs;
  }

  private async _synthesiseRootCause(
    obs:   DebugObservations,
    state: WorkflowState,
  ): Promise<string> {
    const hasData =
      obs.breakpointHits.length > 0 ||
      obs.actuatorBeans !== null ||
      obs.minimalPayload !== null;

    if (!hasData && obs.prunedStack.length === 0) {
      return `(no debug observations — error type: ${obs.errorType})`;
    }

    const summary = {
      errorType:      obs.errorType,
      prunedStack:    obs.prunedStack.slice(0, 5),
      breakpoints:    obs.breakpointHits.slice(0, 2).map(h => ({
        file: h.file, line: h.line,
        vars: Object.entries(h.variables).slice(0, 5),
      })),
      actuatorBeans:  obs.actuatorBeans !== null,
      minimalPayload: obs.minimalPayload,
    };

    try {
      const result = await this.deps.agent.runTask(
        `Task: ${state.task.description}\n\n` +
        `Debug observations:\n${JSON.stringify(summary, null, 2)}\n\n` +
        `Test failures:\n${
          state.verifierVerdict?.testFailures
            .slice(0, 3)
            .map(f => `- ${f.message}`)
            .join('\n') ?? '(none)'
        }`,
        {},
        {
          role: 'debug_analyst',
          systemPrompt: ROOT_CAUSE_PROMPT,
          maxTurns: 1,
          allowedTools: [],
          promptVersion: '2026-06-01-v1',
        },
        0,
      );
      return result.content.trim().slice(0, 600);
    } catch (err) {
      log.warn('debugger.synthesis_failed', { error: String(err) });
      return `(root cause synthesis unavailable — error type: ${obs.errorType})`;
    }
  }
}
