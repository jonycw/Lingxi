import { scrubSecrets, redactValue } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = {
  debug: (message: string, fields?: Record<string, unknown>) => void;
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
};

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(
  level: LogLevel,
  secrets: readonly string[] = [],
  write: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
): Logger {
  const min = RANK[level];
  const emit = (lv: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (RANK[lv] < min) {
      return;
    }
    const payload: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: lv,
      msg: scrubSecrets(message, secrets),
      service: 'lingxi',
    };
    if (fields) {
      Object.assign(payload, redactValue(fields, secrets));
    }
    write(JSON.stringify(payload));
  };
  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}
