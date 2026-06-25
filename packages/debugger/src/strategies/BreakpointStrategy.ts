import type { DebugObservations } from '@tacv/core/state';
import type { IDebugAdapter, ISandboxProvider, SandboxHandle } from '@tacv/core/interfaces';
import type { DebugStrategy } from '../DebugStrategySelector.js';
import type { StackFrame } from '../StackTraceParser.js';
import { createLogger } from '@tacv/core/observability';

const log = createLogger('tacv.debugger.breakpoint');

export interface DebugLaunchConfig {
  type:      string;
  launchCmd: string;
  cwd:       string;
  debugPort: number;
}

export class BreakpointStrategy {
  constructor(
    private readonly sandbox: ISandboxProvider,
    private readonly adapter: IDebugAdapter,
  ) {}

  async execute(
    obs:          DebugObservations,
    frames:       StackFrame[],
    strategy:     DebugStrategy,
    handle:       SandboxHandle,
    launchConfig: DebugLaunchConfig,
  ): Promise<DebugObservations> {
    const userFrames = frames.filter(f => f.isUser);
    if (userFrames.length === 0) {
      log.warn('breakpoint_strategy.no_user_frames');
      return obs;
    }

    const targetFrameIdx = Math.max(0, (userFrames.length - 1) + strategy.breakpointOffset);
    const targetFrame    = userFrames[targetFrameIdx] ?? userFrames[0]!;

    log.info('breakpoint_strategy.target', { file: targetFrame.file, line: targetFrame.line, strategy: strategy.tool });

    // Launch the process with debugger attached
    const [, launchResult] = await Promise.all([
      this.sandbox.execInContainer(handle, launchConfig.launchCmd, { timeoutMs: 120_000 }),
      this._waitForDebugPort(handle, launchConfig.debugPort),
    ]).catch(() => [null, false]);

    if (!launchResult) {
      log.warn('breakpoint_strategy.debug_port_not_ready');
      return obs;
    }

    try {
      await this.adapter.connect('localhost', handle.hostJdwpPort || handle.hostCdpPort);

      if (strategy.conditionalBp) {
        await this.adapter.setConditionalBreakpoint({ file: targetFrame.file, line: targetFrame.line }, strategy.conditionalBp);
      } else {
        await this.adapter.setBreakpoint({ file: targetFrame.file, line: targetFrame.line });
      }

      const hits = [];
      for (let step = 0; step < strategy.maxSteps; step++) {
        const hit = await this.adapter.waitForBreakpointHit(30_000);
        if (!hit) break;

        const extraEvals: Record<string, unknown> = {};
        for (const expr of strategy.evaluateExpressions) {
          try { extraEvals[expr] = await this.adapter.evaluate(expr); } catch { /* ignore */ }
        }
        hits.push({ ...hit, extraEvals });

        if (strategy.stepType === 'step_over') await this.adapter.stepOver();
        else if (strategy.stepType === 'step_into') await this.adapter.stepInto();
        else break;
      }

      return { ...obs, breakpointHits: [...obs.breakpointHits, ...hits] };
    } finally {
      await this.adapter.disconnect().catch(() => {});
    }
  }

  private async _waitForDebugPort(handle: SandboxHandle, port: number, maxWaitMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const res = await this.sandbox.execInContainer(handle, `timeout 1 bash -c "</dev/tcp/localhost/${port}" 2>/dev/null && echo ok || echo fail`);
      if (res.stdout.includes('ok')) return true;
      await new Promise(r => setTimeout(r, 1000));
    }
    return false;
  }
}
