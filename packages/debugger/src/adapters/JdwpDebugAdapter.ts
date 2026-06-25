import { execa } from 'execa';
import type { IDebugAdapter, BreakpointLocation, VariableInfo } from '@tacv/core/interfaces';
import type { BreakpointHit } from '@tacv/core/state';
import { createLogger } from '@tacv/core/observability';

const log = createLogger('tacv.debugger.jdwp');

/**
 * Java Debug Wire Protocol adapter.
 * Uses the 'jdb' command-line debugger as an intermediary (ships with JDK).
 * For production, replace with a direct JDWP socket client.
 */
export class JdwpDebugAdapter implements IDebugAdapter {
  readonly name = 'jdwp';
  private host   = 'localhost';
  private port   = 5005;
  private connected = false;
  private readonly breakpoints: BreakpointLocation[] = [];
  private readonly conditionalBps = new Map<string, string>();
  private hits: BreakpointHit[] = [];

  async connect(host: string, port: number): Promise<void> {
    this.host = host; this.port = port;
    // Verify port is reachable
    await new Promise<void>((resolve, reject) => {
      const net = require('net') as typeof import('net');
      const sock = net.createConnection({ host, port, timeout: 5000 });
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', reject);
    });
    this.connected = true;
    log.info('jdwp.connected', { host, port });
  }

  async disconnect(): Promise<void> { this.connected = false; log.info('jdwp.disconnected'); }

  async setBreakpoint(l: BreakpointLocation): Promise<void> {
    this.breakpoints.push(l);
    log.info('jdwp.breakpoint_queued', l);
  }

  async setConditionalBreakpoint(l: BreakpointLocation, condition: string): Promise<void> {
    this.breakpoints.push(l);
    this.conditionalBps.set(`${l.file}:${l.line}`, condition);
    log.info('jdwp.conditional_bp_queued', { ...l, condition });
  }

  async waitForBreakpointHit(timeoutMs: number): Promise<BreakpointHit | null> {
    if (this.hits.length > 0) return this.hits.shift() ?? null;
    // Build jdb command to attach and run to breakpoints
    const bpArgs = this.breakpoints.flatMap(b => {
      const cls = b.file.replace(/\//g, '.').replace(/\.java$/, '');
      return ['-stop', `at ${cls}:${b.line}`];
    });
    const jdbScript = `where\nlocals\ncont\nquit\n`;
    try {
      const proc = await execa('jdb', ['-attach', `${this.host}:${this.port}`, ...bpArgs], {
        input: jdbScript, timeout: timeoutMs, reject: false,
      });
      return this._parseJdbOutput(proc.stdout + proc.stderr);
    } catch { return null; }
  }

  async getScopeVariables(): Promise<Record<string, VariableInfo>> {
    if (!this.connected) return {};
    // Parse from last jdb 'locals' output
    return {};
  }

  async evaluate(expression: string): Promise<unknown> {
    if (!this.connected) return '<not connected>';
    try {
      const proc = await execa('jdb', ['-attach', `${this.host}:${this.port}`], {
        input: `print ${expression}\nquit\n`, timeout: 5000, reject: false,
      });
      const m = proc.stdout.match(/= (.+)/);
      return m?.[1] ?? '<no result>';
    } catch { return '<eval failed>'; }
  }

  async getCallStack(): Promise<string[]> { return []; }
  async resume():   Promise<void> {}
  async stepOver(): Promise<BreakpointHit | null> { return this.waitForBreakpointHit(5000); }
  async stepInto(): Promise<BreakpointHit | null> { return this.waitForBreakpointHit(5000); }

  private _parseJdbOutput(output: string): BreakpointHit | null {
    const locMatch = output.match(/Breakpoint hit.*at (.+):(\d+)/);
    if (!locMatch) return null;
    const variables: Record<string, VariableInfo> = {};
    for (const m of output.matchAll(/(\w+) = (.+)/g)) {
      if (m[1] && m[2]) variables[m[1]] = { value: m[2].trim(), type: 'unknown' };
    }
    const stack = output.split('\n').filter(l => /at [\w.$]+ \(/.test(l)).map(l => l.trim());
    return { file: locMatch[1] ?? '', line: parseInt(locMatch[2] ?? '0'), variables, callStack: stack, threadId: '1' };
  }
}
