import pino from 'pino';
import { trace } from '@opentelemetry/api';

const LOG_LEVEL  = process.env['LOG_LEVEL']  ?? 'info';
const LOG_FORMAT = process.env['LOG_FORMAT'] ?? 'json';

export const baseLogger = pino({
  level: LOG_LEVEL,
  ...(LOG_FORMAT === 'pretty' ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  formatters: { level: (label: string) => ({ level: label }) },
  mixin: () => {
    const span = trace.getActiveSpan();
    if (!span) return {};
    const ctx = span.spanContext();
    return { traceId: ctx.traceId, spanId: ctx.spanId };
  },
  redact: ['apiKey', 'password', 'authorization', 'token', 'secretKey'],
  base: { service: 'tacv', version: process.env['npm_package_version'] ?? '1.0.0' },
});

export function createLogger(name: string): pino.Logger {
  return baseLogger.child({ logger: name });
}

export const log = createLogger('tacv');
