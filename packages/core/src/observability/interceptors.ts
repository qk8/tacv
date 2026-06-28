import { trace, SpanStatusCode, context } from '@opentelemetry/api';
import { Context } from '@temporalio/activity';
import { createLogger } from './logger.js';

const log    = createLogger('tacv.activity.interceptor');
const tracer = trace.getTracer('tacv');

// Use unknown interface to avoid @temporalio/activity type coupling in the interceptor itself
// The actual Temporal types are injected at worker registration time
export interface ActivityInboundCallsInterceptor {
  execute(input: { headers: Record<string, Buffer | undefined> }, next: (input: unknown) => Promise<unknown>): Promise<unknown>;
}

export class ObservabilityInterceptor implements ActivityInboundCallsInterceptor {
  async execute(
    input: { headers: Record<string, Buffer | undefined> },
    next:  (input: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    // Read activity name from Temporal's Context (correct API) with header fallback
    const activityName = (() => {
      try { return Context.current().info.activityType; }
      catch { return (input.headers['activityName'] as Buffer | undefined)?.toString() ?? 'unknown'; }
    })();
    const span = tracer.startSpan(`tacv.activity.${activityName}`);
    const ctx  = trace.setSpan(context.active(), span);
    const t0   = performance.now();

    log.info(`${activityName}.start`);

    return context.with(ctx, async () => {
      try {
        const result  = await next(input);
        const durMs   = Math.round(performance.now() - t0);
        span.setStatus({ code: SpanStatusCode.OK });
        span.setAttribute('tacv.duration_ms', durMs);
        log.info(`${activityName}.complete`, { durationMs: durMs });
        return result;
      } catch (err) {
        const durMs = Math.round(performance.now() - t0);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        span.setAttribute('tacv.duration_ms', durMs);
        log.error(`${activityName}.failed`, {
          durationMs: durMs,
          error:      err instanceof Error ? err.message      : String(err),
          errorType:  err instanceof Error ? err.constructor.name : 'UnknownError',
          stack:      err instanceof Error ? err.stack        : undefined,
        });
        throw err;
      } finally {
        span.end();
      }
    });
  }
}
