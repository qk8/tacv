import type { DebugObservations, WorkflowState } from '@tacv/core/state';
import type { ISandboxProvider, SandboxHandle } from '@tacv/core/interfaces';
import { createLogger } from '@tacv/core/observability';

const log = createLogger('tacv.debugger.delta');

export class DeltaDebugStrategy {
  constructor(private readonly sandbox: ISandboxProvider) {}

  async execute(
    obs:        DebugObservations,
    state:      WorkflowState,
    handle:     SandboxHandle,
    moduleType: string,
  ): Promise<DebugObservations> {
    log.info('delta_debug.start', { moduleType });

    // Build an initial test payload from the failure context
    const failures = state.verifierVerdict?.testFailures ?? [];
    if (failures.length === 0) return obs;

    const payload = this._inferPayloadFromFailure(failures[0]?.message ?? '');
    if (Object.keys(payload).length === 0) return obs;

    // Binary-search: bisect fields until we find the minimal failing subset
    const minimal = await this._bisectPayload(payload, handle, moduleType);

    log.info('delta_debug.minimal_found', { fields: Object.keys(minimal) });
    return { ...obs, minimalPayload: minimal };
  }

  private async _bisectPayload(
    payload:    Record<string, unknown>,
    handle:     SandboxHandle,
    moduleType: string,
  ): Promise<Record<string, unknown>> {
    const keys = Object.keys(payload);
    if (keys.length <= 1) return payload;

    // Binary split
    const half1 = Object.fromEntries(keys.slice(0, Math.floor(keys.length / 2)).map(k => [k, payload[k]]));
    const half2 = Object.fromEntries(keys.slice(Math.floor(keys.length / 2)).map(k => [k, payload[k]]));

    for (const half of [half1, half2]) {
      if (await this._fails(half, handle, moduleType)) {
        return this._bisectPayload(half, handle, moduleType);
      }
    }
    return payload;
  }

  private async _fails(payload: Record<string, unknown>, handle: SandboxHandle, moduleType: string): Promise<boolean> {
    const body = JSON.stringify(payload);
    const endpoint = moduleType.includes('java') ? 'http://localhost:8080/api/test' : 'http://localhost:3000/api/test';
    const result = await this.sandbox.execInContainer(
      handle,
      `curl -s -w '\\n%{http_code}' -X POST '${endpoint}' -H 'Content-Type: application/json' -d '${body.replace(/'/g, "'\\''")}' 2>/dev/null`,
      { timeoutMs: 10_000 },
    );
    const lines    = result.stdout.split('\n');
    const httpCode = parseInt(lines[lines.length - 1] ?? '0');
    return httpCode >= 400 || result.exitCode !== 0;
  }

  private _inferPayloadFromFailure(message: string): Record<string, unknown> {
    // Extract key=value patterns from the failure message
    const payload: Record<string, unknown> = {};
    for (const m of message.matchAll(/(\w+)[=:\s]+['"]?([^'",\s}]+)['"]?/g)) {
      if (m[1] && m[2] && m[1].length < 30 && m[2].length < 100) {
        payload[m[1]] = m[2];
      }
    }
    return payload;
  }
}
