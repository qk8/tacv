import WebSocket from 'ws';
import type { IDebugAdapter, BreakpointLocation, VariableInfo } from '@tacv/core/interfaces';
import type { BreakpointHit } from '@tacv/core/state';
import { createLogger } from '@tacv/core/observability';

const log = createLogger('tacv.debugger.cdp');

export class CdpDebugAdapter implements IDebugAdapter {
  readonly name = 'cdp';
  private ws:      WebSocket | null = null;
  private callId   = 0;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private pausedEvent: Record<string, unknown> | null = null;

  async connect(host: string, port: number): Promise<void> {
    const res     = await fetch(`http://${host}:${port}/json`);
    const targets = await res.json() as Array<{ webSocketDebuggerUrl?: string }>;
    const wsUrl   = targets[0]?.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error(`No CDP debug target at ${host}:${port}`);
    this.ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => { this.ws!.on('open', res); this.ws!.on('error', rej); });
    this.ws.on('message', (d: Buffer) => this._handleMsg(JSON.parse(d.toString()) as Record<string, unknown>));
    await this._send('Debugger.enable', {});
    log.info('cdp.connected', { host, port });
  }

  async disconnect(): Promise<void> { this.ws?.close(); this.ws = null; }

  async setBreakpoint(l: BreakpointLocation): Promise<void> {
    await this._send('Debugger.setBreakpointByUrl', { lineNumber: l.line - 1, url: l.file.replace(/\.tsx?$/, '.js') });
  }

  async setConditionalBreakpoint(l: BreakpointLocation, condition: string): Promise<void> {
    await this._send('Debugger.setBreakpointByUrl', { lineNumber: l.line - 1, url: l.file.replace(/\.tsx?$/, '.js'), condition });
  }

  async waitForBreakpointHit(ms: number): Promise<BreakpointHit | null> {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve(null), ms);
      const h = (d: Buffer) => {
        const msg = JSON.parse(d.toString()) as Record<string, unknown>;
        if (msg['method'] === 'Debugger.paused') {
          clearTimeout(t); this.ws?.off('message', h);
          this.pausedEvent = msg['params'] as Record<string, unknown>;
          resolve(this._buildHit());
        }
      };
      this.ws?.on('message', h);
      void this.resume();
    });
  }

  async getScopeVariables(): Promise<Record<string, VariableInfo>> {
    if (!this.pausedEvent) return {};
    const frames = this.pausedEvent['callFrames'] as Array<{ scopeChain: Array<{ object: { objectId: string }; type: string }> }>;
    const out: Record<string, VariableInfo> = {};
    for (const scope of frames[0]?.scopeChain ?? []) {
      if (scope.type === 'global') continue;
      const props = await this._send('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true }) as { result: Array<{ name: string; value?: { value?: unknown; type?: string; description?: string } }> };
      for (const p of props.result) if (p.value) out[p.name] = { value: p.value.value ?? p.value.description, type: p.value.type ?? 'unknown' };
    }
    return out;
  }

  async evaluate(expr: string): Promise<unknown> {
    if (!this.pausedEvent) return '<no frame>';
    const frames = this.pausedEvent['callFrames'] as Array<{ callFrameId: string }>;
    const fid = frames[0]?.callFrameId;
    if (!fid) return '<no frame>';
    const r = await this._send('Debugger.evaluateOnCallFrame', { callFrameId: fid, expression: expr, returnByValue: true }) as { result: { value?: unknown; description?: string } };
    return r.result.value ?? r.result.description;
  }

  async getCallStack(): Promise<string[]> {
    if (!this.pausedEvent) return [];
    return (this.pausedEvent['callFrames'] as Array<{ functionName: string; url: string; location: { lineNumber: number } }>)
      .map(f => `${f.functionName}(${f.url}:${f.location.lineNumber + 1})`);
  }

  async resume():   Promise<void> { await this._send('Debugger.resume', {}); }
  async stepOver(): Promise<BreakpointHit | null> { await this._send('Debugger.stepOver', {}); return this.waitForBreakpointHit(5000); }
  async stepInto(): Promise<BreakpointHit | null> { await this._send('Debugger.stepInto', {}); return this.waitForBreakpointHit(5000); }

  private _buildHit(): BreakpointHit {
    const f = (this.pausedEvent?.['callFrames'] as Array<{ url: string; location: { lineNumber: number } }>)[0];
    return { file: f?.url ?? '', line: (f?.location.lineNumber ?? 0) + 1, variables: {}, callStack: [], threadId: '1' };
  }
  private _handleMsg(msg: Record<string, unknown>): void {
    const id = msg['id'] as number | undefined;
    if (id === undefined) return;
    const p = this.pending.get(id); if (!p) return;
    this.pending.delete(id);
    if ('error' in msg) p.reject(new Error(JSON.stringify(msg['error']))); else p.resolve(msg['result']);
  }
  private _send(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((res, rej) => { const id = ++this.callId; this.pending.set(id, { resolve: res, reject: rej }); this.ws!.send(JSON.stringify({ id, method, params })); });
  }
}
