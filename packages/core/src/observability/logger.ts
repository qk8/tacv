/* eslint-disable @typescript-eslint/no-explicit-any */
type Logger = {
  info:  (msg: string, data?: Record<string, unknown>) => void;
  warn:  (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
  debug: (msg: string, data?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
};

function makeLogger(name: string): Logger {
  const log = (level: string) => (msg: string, data?: Record<string, unknown>) => {
    if (process.env['TACV_LOG'] === 'silent') return;
    const line = JSON.stringify({ level, logger: name, msg, ...data });
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else if (process.env['LOG_LEVEL'] !== 'silent') process.stdout.write(line + '\n');
  };
  const logger: Logger = {
    info:  log('info'),
    warn:  log('warn'),
    error: log('error'),
    debug: log('debug'),
    child: (bindings) => makeLogger(`${name}[${JSON.stringify(bindings)}]`),
  };
  return logger;
}

export function createLogger(name: string): Logger { return makeLogger(name); }
export const baseLogger = makeLogger('tacv');
export const log        = makeLogger('tacv');
