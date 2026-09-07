import type { LoggerService, LogLevel } from '@nestjs/common';
import { currentRequestId } from './request-context';

/**
 * One JSON object per line on stdout (stderr for `error` and `fatal`), which is what every hosting platform's log
 * pipeline can index (CB-047, BRD-8.11). It implements Nest's own `LoggerService`, so services keep using the
 * built-in `new Logger(Context)` facade and no logging dependency is added.
 *
 * Nest's `ConsoleLogger` can already print JSON (`{ json: true }`), but its record is built by a private method
 * with no way to add the request id, so the record is built here instead.
 *
 * PII rule: this logger never reaches into request or response bodies. What it prints is what the caller passed,
 * and callers pass opaque ids (checkInId, attemptId, receiverId, userId), enum values, provider error codes and
 * `error.message` — never a phone number, a person's name or a message body (BRD-8.7).
 */
export type JsonLogWriter = (line: string, level: LogLevel) => void;

export interface JsonLoggerOptions {
  /** Levels that are printed. Defaults to everything except `debug` and `verbose`. */
  levels?: readonly LogLevel[];
  /** Where a finished line goes. Defaults to stdout, or stderr for `error` and `fatal`. */
  write?: JsonLogWriter;
  now?: () => Date;
}

/** Fields the logger owns; a caller's object cannot overwrite them. */
export const RESERVED_LOG_FIELDS: readonly string[] = ['timestamp', 'level', 'context', 'requestId'];

export const DEFAULT_LOG_LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'log'];

const STDERR_LEVELS: readonly LogLevel[] = ['error', 'fatal'];
/** Bounded so one hostile or runaway message cannot fill the log pipeline. */
const MAX_MESSAGE_LENGTH = 2000;

function defaultWrite(line: string, level: LogLevel): void {
  const stream = STDERR_LEVELS.includes(level) ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(value: string): string {
  return value.length > MAX_MESSAGE_LENGTH ? `${value.slice(0, MAX_MESSAGE_LENGTH)}…` : value;
}

/**
 * Splits Nest's trailing context argument off the optional parameters. The built-in `Logger` facade appends its
 * context as the last argument, and `error()` may pass a stack before it.
 */
export function splitLoggerParams(optionalParams: readonly unknown[]): {
  context?: string;
  stack?: string;
  extras: unknown[];
} {
  const params = [...optionalParams];
  const context = typeof params.at(-1) === 'string' ? (params.pop() as string) : undefined;
  const stackIndex = params.findIndex((param) => typeof param === 'string');
  const stack = stackIndex === -1 ? undefined : (params.splice(stackIndex, 1)[0] as string);

  return { context, stack, extras: params };
}

export class JsonLogger implements LoggerService {
  private levels: Set<LogLevel>;
  private readonly write: JsonLogWriter;
  private readonly now: () => Date;

  constructor(options: JsonLoggerOptions = {}) {
    this.levels = new Set(options.levels ?? DEFAULT_LOG_LEVELS);
    this.write = options.write ?? defaultWrite;
    this.now = options.now ?? (() => new Date());
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('log', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('warn', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('error', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('fatal', message, optionalParams);
  }

  setLogLevels(levels: LogLevel[]): void {
    this.levels = new Set(levels);
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this.levels.has(level);
  }

  private emit(level: LogLevel, message: unknown, optionalParams: readonly unknown[]): void {
    if (!this.levels.has(level)) {
      return;
    }

    const { context, stack, extras } = splitLoggerParams(optionalParams);
    const record: Record<string, unknown> = {
      timestamp: this.now().toISOString(),
      level,
    };
    if (context) {
      record.context = context;
    }
    const requestId = currentRequestId();
    if (requestId) {
      record.requestId = requestId;
    }

    this.assign(record, this.messageFields(message));
    for (const extra of extras) {
      if (isPlainObject(extra)) {
        this.assign(record, extra);
      }
    }
    if (stack) {
      record.stack = truncate(stack);
    }

    this.write(JSON.stringify(record), level);
  }

  /**
   * A string message becomes `message`; an object message is spread, so a caller can log structured fields with
   * `logger.warn({ message: 'Provider send failed', failureReason })`.
   */
  private messageFields(message: unknown): Record<string, unknown> {
    if (typeof message === 'string') {
      return { message: truncate(message) };
    }
    if (message instanceof Error) {
      return { message: truncate(message.message), errorName: message.name };
    }
    if (isPlainObject(message)) {
      return message;
    }

    return { message: truncate(String(message)) };
  }

  private assign(record: Record<string, unknown>, fields: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(fields)) {
      if (RESERVED_LOG_FIELDS.includes(key) || value === undefined) {
        continue;
      }
      record[key] = typeof value === 'string' ? truncate(value) : value;
    }
  }
}
