import type { LogLevel } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { JsonLogger, splitLoggerParams } from './json-logger';
import { runWithRequestContext } from './request-context';

function capturingLogger(levels?: readonly LogLevel[]) {
  const lines: { line: string; level: LogLevel }[] = [];
  const logger = new JsonLogger({
    levels,
    write: (line, level) => lines.push({ line, level }),
    now: () => new Date('2026-09-07T09:15:00.000Z'),
  });

  return { logger, lines, records: () => lines.map((entry) => JSON.parse(entry.line) as Record<string, unknown>) };
}

describe('JsonLogger', () => {
  it('writes one parseable JSON object per line with the level, timestamp and context', () => {
    const { logger, lines, records } = capturingLogger();

    logger.log('Nest application successfully started', 'NestApplication');

    expect(lines).toHaveLength(1);
    expect(lines[0]?.line).not.toContain('\n');
    expect(records()[0]).toEqual({
      timestamp: '2026-09-07T09:15:00.000Z',
      level: 'log',
      context: 'NestApplication',
      message: 'Nest application successfully started',
    });
  });

  it('spreads a structured message so provider failures carry their own fields', () => {
    const { logger, records } = capturingLogger();

    logger.error(
      {
        message: 'Cascade check-in attempt could not be sent',
        event: 'check_in.attempt_failed',
        checkInId: 'check-in-1',
        channel: 'SMS',
        failureReason: 'twilio_21606',
        providerErrorCode: 21606,
      },
      'CheckInsService',
    );

    expect(records()[0]).toEqual({
      timestamp: '2026-09-07T09:15:00.000Z',
      level: 'error',
      context: 'CheckInsService',
      message: 'Cascade check-in attempt could not be sent',
      event: 'check_in.attempt_failed',
      checkInId: 'check-in-1',
      channel: 'SMS',
      failureReason: 'twilio_21606',
      providerErrorCode: 21606,
    });
  });

  it('adds the current request id to every line written while a request is handled', () => {
    const { logger, records } = capturingLogger();

    runWithRequestContext({ requestId: '2f1c9b1a-0000-4000-8000-0000000000ff' }, () => {
      logger.warn('Rate limit reached', 'ThrottlerGuard');
    });
    logger.warn('Scheduler tick finished', 'CheckInsService');

    expect(records()[0]?.requestId).toBe('2f1c9b1a-0000-4000-8000-0000000000ff');
    expect(records()[1]).not.toHaveProperty('requestId');
  });

  it('sends error and fatal to stderr and everything else to stdout', () => {
    const { logger, lines } = capturingLogger(['fatal', 'error', 'warn', 'log']);

    logger.log('up', 'Ctx');
    logger.warn('careful', 'Ctx');
    logger.error('broken', 'Ctx');
    logger.fatal('gone', 'Ctx');

    expect(lines.map((entry) => entry.level)).toEqual(['log', 'warn', 'error', 'fatal']);
  });

  it('drops levels that are not enabled, and honours setLogLevels', () => {
    const { logger, lines, records } = capturingLogger();

    logger.debug('noisy', 'Ctx');
    logger.verbose('noisier', 'Ctx');
    expect(lines).toHaveLength(0);

    logger.setLogLevels(['debug']);
    logger.debug('now wanted', 'Ctx');
    logger.error('now dropped', 'Ctx');
    expect(lines).toHaveLength(1);
    expect(records()[0]?.message).toBe('now wanted');
  });

  it('never lets a caller overwrite the fields the logger owns', () => {
    const { logger, records } = capturingLogger();

    runWithRequestContext({ requestId: '2f1c9b1a-0000-4000-8000-0000000000ff' }, () => {
      logger.warn(
        { message: 'spoofed', level: 'log', timestamp: 'yesterday', requestId: 'someone-elses', context: 'Fake' },
        'RealContext',
      );
    });

    expect(records()[0]).toMatchObject({
      timestamp: '2026-09-07T09:15:00.000Z',
      level: 'warn',
      context: 'RealContext',
      requestId: '2f1c9b1a-0000-4000-8000-0000000000ff',
      message: 'spoofed',
    });
  });

  it('records an Error message and name, and keeps the stack out of the message', () => {
    const { logger, records } = capturingLogger();

    logger.error(new Error('Twilio request failed (HTTP 400, error code 21606)'), 'at send (twilio.ts:1)', 'Ctx');

    expect(records()[0]).toMatchObject({
      message: 'Twilio request failed (HTTP 400, error code 21606)',
      errorName: 'Error',
      stack: 'at send (twilio.ts:1)',
      context: 'Ctx',
    });
  });

  it('truncates a runaway message so one line cannot fill the log pipeline', () => {
    const { logger, records } = capturingLogger();

    logger.warn('x'.repeat(5000), 'Ctx');

    expect(String(records()[0]?.message)).toHaveLength(2001);
    expect(String(records()[0]?.message).endsWith('…')).toBe(true);
  });
});

describe('splitLoggerParams', () => {
  it('takes the trailing context and a stack that precedes it', () => {
    expect(splitLoggerParams(['at boom (file.ts:1)', 'CheckInsService'])).toEqual({
      context: 'CheckInsService',
      stack: 'at boom (file.ts:1)',
      extras: [],
    });
  });

  it('keeps object parameters as extras', () => {
    expect(splitLoggerParams([{ checkInId: 'check-in-1' }, 'CheckInsService'])).toEqual({
      context: 'CheckInsService',
      stack: undefined,
      extras: [{ checkInId: 'check-in-1' }],
    });
  });
});
