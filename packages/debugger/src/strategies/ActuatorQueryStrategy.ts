import type { DebugObservations } from '@tacv/contracts';
import type { ISandboxProvider, SandboxHandle } from '@tacv/contracts';
import { createLogger } from '@tacv/core/observability';

const log = createLogger('tacv.debugger.actuator');

export class ActuatorQueryStrategy {
  constructor(private readonly sandbox: ISandboxProvider) {}

  async execute(obs: DebugObservations, handle: SandboxHandle, actuatorBaseUrl: string): Promise<DebugObservations> {
    log.info('actuator_strategy.start', { url: actuatorBaseUrl });

    let actuatorBeans: unknown = null;
    let actuatorEnv:   unknown = null;

    for (const [key, endpoint] of [['beans', '/beans'], ['env', '/env']] as const) {
      try {
        const res = await handle !== null
          ? await this.sandbox.execInContainer(handle, `curl -s "${actuatorBaseUrl}${endpoint}" 2>/dev/null`, { timeoutMs: 5_000 })
          : { stdout: '', stderr: '', exitCode: 1 };
        if (res.exitCode === 0 && res.stdout.startsWith('{')) {
          const parsed = JSON.parse(res.stdout);
          if (key === 'beans') actuatorBeans = parsed;
          else actuatorEnv = parsed;
        }
      } catch (err) {
        log.warn(`actuator_strategy.${key}_failed`, { error: String(err) });
      }
    }

    return { ...obs, actuatorBeans, actuatorEnv };
  }
}
