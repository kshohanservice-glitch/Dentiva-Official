import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  ts: string;
  level: LogLevel;
  stream: 'app' | 'error' | 'security';
  msg: string;
  [key: string]: unknown;
}

const REDACT = /("?(password|passcode|passwordHash|activationCode|code|secret|token|auth)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 8;

function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.replace(REDACT, '$1"[redacted]"');
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /password|passcode|activation|secret|token|hash/i.test(k) ? '[redacted]' : scrub(v);
    }
    return out;
  }
  return value;
}

/**
 * Structured, rotating, line-delimited JSON logging.
 * Application, error and security streams are kept apart so an administrator
 * can share the right one for support without leaking anything.
 */
export class Logger {
  private logDir: string;
  private minLevel: LogLevel;
  private console: boolean;

  constructor(logDir: string, opts: { minLevel?: LogLevel; console?: boolean } = {}) {
    this.logDir = logDir;
    this.minLevel = opts.minLevel ?? 'info';
    this.console = opts.console ?? false;
    if (this.console || process.env.DENTIVA_LOG_STDOUT === '1') mkdirSync(logDir, { recursive: true });
  }

  private static order(level: LogLevel): number {
    return { debug: 10, info: 20, warn: 30, error: 40 }[level];
  }

  private enabled(level: LogLevel): boolean {
    return Logger.order(level) >= Logger.order(this.minLevel);
  }

  private write(record: LogRecord): void {
    const line = `${JSON.stringify(scrub(record) as LogRecord)}\n`;
    const file = join(this.logDir, `${record.stream}.log`);
    try {
      mkdirSync(this.logDir, { recursive: true });
      appendFileSync(file, line, 'utf8');
      this.rotateIfNeeded(file);
    } catch {
      /* logging must never break the application */
    }
    if (this.console || process.env.DENTIVA_LOG_STDOUT === '1') {
      const sink = record.level === 'error' || record.level === 'warn' ? process.stderr : process.stdout;
      sink.write(line);
    }
  }

  private rotateIfNeeded(file: string): void {
    try {
      if (!existsSync(file) || statSync(file).size < MAX_BYTES) return;
      const base = file.replace(/\.log$/, '');
      for (let i = MAX_FILES - 1; i >= 1; i -= 1) {
        const from = `${base}.${i}.log`;
        const to = `${base}.${i + 1}.log`;
        if (existsSync(from)) {
          if (i === MAX_FILES - 1) unlinkSync(from);
          else {
            try {
              unlinkSync(to);
            } catch {
              /* ignore */
            }
            renameSync(from, to);
          }
        }
      }
      renameSync(file, `${base}.1.log`);
    } catch {
      /* rotation is best-effort */
    }
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    if (this.enabled('debug')) this.write({ ts: new Date().toISOString(), level: 'debug', stream: 'app', msg, ...(fields ?? {}) });
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    if (this.enabled('info')) this.write({ ts: new Date().toISOString(), level: 'info', stream: 'app', msg, ...(fields ?? {}) });
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    if (this.enabled('warn')) this.write({ ts: new Date().toISOString(), level: 'warn', stream: 'error', msg, ...(fields ?? {}) });
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    if (this.enabled('error')) this.write({ ts: new Date().toISOString(), level: 'error', stream: 'error', msg, ...(fields ?? {}) });
  }
  security(msg: string, fields?: Record<string, unknown>): void {
    this.write({ ts: new Date().toISOString(), level: 'warn', stream: 'security', msg, ...(fields ?? {}) });
  }

  listLogs(): { name: string; bytes: number; modifiedAt: string }[] {
    try {
      if (!existsSync(this.logDir)) return [];
      return readdirSync(this.logDir)
        .filter((f) => f.endsWith('.log'))
        .map((name) => {
          const st = statSync(join(this.logDir, name));
          return { name, bytes: st.size, modifiedAt: st.mtime.toISOString() };
        })
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    } catch {
      return [];
    }
  }

  readLog(name: string, maxLines = 500): string[] {
    const safe = name.replace(/[^A-Za-z0-9._-]/g, '');
    if (!safe.endsWith('.log')) return [];
    try {
      const content = readFileSync(join(this.logDir, safe), 'utf8');
      const lines = content.split('\n').filter(Boolean);
      return lines.slice(-maxLines);
    } catch {
      return [];
    }
  }
}

let shared: Logger | null = null;
export function getLogger(logDir: string, opts?: { minLevel?: LogLevel; console?: boolean }): Logger {
  if (!shared) shared = new Logger(logDir, opts);
  return shared;
}
export function setLogger(logger: Logger): void {
  shared = logger;
}
