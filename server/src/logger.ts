type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, scope: string, message: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${message}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (extra !== undefined) fn(line, extra);
  else fn(line);
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => write('debug', scope, msg, extra),
    info: (msg: string, extra?: unknown) => write('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => write('error', scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
