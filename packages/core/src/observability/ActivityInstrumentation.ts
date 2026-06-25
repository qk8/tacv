import { createLogger } from './logger.js';

const log = createLogger('tacv.activity.interceptor');

export interface ActivityExecuteInput {
  readonly args:    readonly unknown[];
  readonly headers: Record<string, string | Uint8Array | undefined>;
}

export type Next = (input: ActivityExecuteInput) => Promise<unknown>;

export class ObservabilityInterceptor {
  async execute(input: ActivityExecuteInput, next: Next): Promise<unknown> {
    const activityName = (input.headers['activityName'] as string | undefined) ?? 'unknown';
    const t0 = performance.now();

    log.info(`${activityName}.start`);

    try {
      const result = await next(input);
      const durationMs = Math.round(performance.now() - t0);
      log.info(`${activityName}.complete`, { durationMs });
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      log.error(`${activityName}.failed`, {
        durationMs,
        error:     err instanceof Error ? err.message    : String(err),
        errorType: err instanceof Error ? err.constructor.name : 'UnknownError',
        stack:     err instanceof Error ? err.stack      : undefined,
      });
      throw err;
    }
  }
}
