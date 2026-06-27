import * as net from 'node:net';
import type { IDebugAdapter, BreakpointLocation, VariableInfo } from '@tacv/contracts';
import type { BreakpointHit } from '@tacv/contracts';
import { createLogger } from '@tacv/core/observability';

const log = createLogger('tacv.debugger.dap');

/**
 * Generic Debug Adapter Protocol (DAP) adapter.
 * Works with any language that has a DAP server (Java, Python, Go, C#, Rust…).
 * See: https://microsoft.github.io/debug-adapter-protocol/
 */
export class DapDebugAdapter implements IDebugAdapter {
  readonly name = 'dap';
  private socket:   net.Socket | null = null;
  private seqId     = 0;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly events:  Array<Record<string, unknown>> = [];
  private buf       = '';
  private paused:   Record<string, unknown> | null = null;
  private threadId  = 1;

  async connect(host: string, port: number): Promise<void> {
    this.socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.createConnection({ host, port });
      s.once('connect', () => resolve(s));
      s.once('error', reject);
    });
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => this._onData(chunk));
    await this._request('initialize', { adapterID: 'tacv', linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true, supportsConditionalBreakpoints: true });
    log.info('dap.connected', { host, port });
  }

  async disconnect(): Promise<void> {
    await this._request('disconnect', { terminateDebuggee: false }).catch(() => {});
    this.socket?.destroy();
    this.socket = null;
  }

  async setBreakpoint(l: BreakpointLocation): Promise<void> {
    await this._request('setBreakpoints', { source: { path: l.file }, breakpoints: [{ line: l.line }] });
  }

  async setConditionalBreakpoint(l: BreakpointLocation, condition: string): Promise<void> {
    await this._request('setBreakpoints', { source: { path: l.file }, breakpoints: [{ line: l.line, condition }] });
    log.info('dap.conditional_bp', { ...l, condition });
  }

  async waitForBreakpointHit(ms: number): Promise<BreakpointHit | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const stoppedIdx = this.events.findIndex(e => e['event'] === 'stopped');
      if (stoppedIdx >= 0) {
        const ev = this.events.splice(stoppedIdx, 1)[0]!;
        this.paused   = ev['body'] as Record<string, unknown>;
        this.threadId = (this.paused?.['threadId'] as number) ?? 1;
        return await this._buildHit();
      }
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  }

  async getScopeVariables(): Promise<Record<string, VariableInfo>> {
    if (!this.paused) return {};
    const stack  = await this._request('stackTrace', { threadId: this.threadId, levels: 1 }) as { stackFrames: Array<{ id: number }> };
    const fid    = stack.stackFrames[0]?.id ?? 0;
    const scopes = await this._request('scopes', { frameId: fid }) as { scopes: Array<{ variablesReference: number; name: string }> };
    const out: Record<string, VariableInfo> = {};
    for (const scope of scopes.scopes.filter(s => s.name !== 'Globals')) {
      const vars = await this._request('variables', { variablesReference: scope.variablesReference }) as { variables: Array<{ name: string; value: string; type?: string }> };
      for (const v of vars.variables) out[v.name] = { value: v.value, type: v.type ?? 'unknown' };
    }
    return out;
  }

  async evaluate(expr: string): Promise<unknown> {
    if (!this.paused) return '<no frame>';
    const stack = await this._request('stackTrace', { threadId: this.threadId, levels: 1 }) as { stackFrames: Array<{ id: number }> };
    const fid   = stack.stackFrames[0]?.id ?? 0;
    const r     = await this._request('evaluate', { expression: expr, frameId: fid, context: 'watch' }) as { result: string };
    return r.result;
  }

  async getCallStack(): Promise<string[]> {
    if (!this.paused) return [];
    const stack = await this._request('stackTrace', { threadId: this.threadId, levels: 10 }) as { stackFrames: Array<{ name: string; source?: { path?: string }; line: number }> };
    return stack.stackFrames.map(f => `${f.name}(${f.source?.path ?? '?'}:${f.line})`);
  }

  async resume():   Promise<void> { await this._request('continue', { threadId: this.threadId }); }
  async stepOver(): Promise<BreakpointHit | null> { await this._request('next', { threadId: this.threadId }); return this.waitForBreakpointHit(5000); }
  async stepInto(): Promise<BreakpointHit | null> { await this._request('stepIn', { threadId: this.threadId }); return this.waitForBreakpointHit(5000); }

  private async _buildHit(): Promise<BreakpointHit> {
    const stack = await this.getCallStack();
    const vars  = await this.getScopeVariables();
    const top   = stack[0] ?? '';
    const m     = top.match(/\((.+):(\d+)\)$/);
    return { file: m?.[1] ?? '', line: parseInt(m?.[2] ?? '0'), variables: vars, callStack: stack, threadId: String(this.threadId) };
  }

  private _request(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const seq = ++this.seqId;
      const msg = { seq, type: 'request', command, arguments: args };
      const body = JSON.stringify(msg);
      const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
      this.pending.set(seq, { resolve, reject });
      this.socket!.write(header + body);
    });
  }

  private _onData(chunk: string): void {
    this.buf += chunk;
    while (true) {
      const hdrEnd = this.buf.indexOf('\r\n\r\n');
      if (hdrEnd < 0) break;
      const lenMatch = this.buf.slice(0, hdrEnd).match(/Content-Length:\s*(\d+)/i);
      if (!lenMatch) { this.buf = ''; break; }
      const len   = parseInt(lenMatch[1]!);
      const start = hdrEnd + 4;
      if (this.buf.length < start + len) break;
      const raw = this.buf.slice(start, start + len);
      this.buf  = this.buf.slice(start + len);
      try {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        if (msg['type'] === 'response') {
          const seq = msg['request_seq'] as number;
          const p   = this.pending.get(seq);
          if (p) { this.pending.delete(seq); (msg['success'] ? p.resolve(msg['body']) : p.reject(new Error(JSON.stringify(msg['message'])))); }
        } else if (msg['type'] === 'event') {
          this.events.push(msg);
        }
      } catch { /* ignore malformed */ }
    }
  }
}
