import { describe, expect, it } from 'vitest';
import {
  assertSupportedTimeZone,
  isSupportedTimeZone,
  parseScheduleTimeWindow,
  ReceiverScheduleValidationError,
  timeOfDayToMinutes,
} from './receiver-schedule';

describe('receiver schedule validation', () => {
  it('accepts canonical IANA zones and the links Intl.DateTimeFormat resolves', () => {
    expect(isSupportedTimeZone('Asia/Dubai')).toBe(true);
    expect(isSupportedTimeZone('Europe/London')).toBe(true);
    expect(isSupportedTimeZone('UTC')).toBe(true);
    expect(isSupportedTimeZone('Asia/Calcutta')).toBe(true);
  });

  it('rejects city names, offsets and empty values as time zones', () => {
    expect(isSupportedTimeZone('Dubai')).toBe(false);
    expect(isSupportedTimeZone('GMT+4')).toBe(false);
    expect(isSupportedTimeZone('')).toBe(false);
    expect(() => assertSupportedTimeZone('Dubai')).toThrow(ReceiverScheduleValidationError);
    expect(() => assertSupportedTimeZone('Dubai')).toThrow(
      expect.objectContaining({ code: 'INVALID_TIMEZONE' }) as unknown as Error,
    );
  });

  it('parses a start and end in HH:mm and drops anything else', () => {
    expect(parseScheduleTimeWindow({ start: '09:00', end: '11:30', label: 'morning' })).toEqual({
      start: '09:00',
      end: '11:30',
    });
    expect(parseScheduleTimeWindow({ start: '22:00', end: '06:00' })).toEqual({ start: '22:00', end: '06:00' });
  });

  it.each([
    ['an array', []],
    ['null', null],
    ['a string', '09:00-11:00'],
    ['an empty object', {}],
    ['a missing end', { start: '09:00' }],
    ['an unpadded hour', { start: '9:00', end: '17:00' }],
    ['an out-of-range hour', { start: '24:00', end: '17:00' }],
    ['an out-of-range minute', { start: '09:60', end: '17:00' }],
    ['a non-string time', { start: 900, end: 1700 }],
  ])('rejects %s as a schedule time window', (_label, value) => {
    expect(() => parseScheduleTimeWindow(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_SCHEDULE_TIME_WINDOW' }) as unknown as Error,
    );
  });

  it('converts validated HH:mm values to minutes since midnight', () => {
    expect(timeOfDayToMinutes('00:00')).toBe(0);
    expect(timeOfDayToMinutes('09:30')).toBe(570);
    expect(timeOfDayToMinutes('23:59')).toBe(1439);
  });
});
