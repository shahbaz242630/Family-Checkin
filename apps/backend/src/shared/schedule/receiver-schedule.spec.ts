import { describe, expect, it } from 'vitest';
import {
  assertSupportedTimeZone,
  isInsideScheduleWindow,
  isSupportedTimeZone,
  localClockInTimeZone,
  localDateInTimeZone,
  parseScheduleTimeWindow,
  ReceiverScheduleValidationError,
  scheduleDayOf,
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

describe('receiver local clock and schedule day (CB-013)', () => {
  it('reads the local date and minutes in the receiver zone, across UTC midnight', () => {
    // 00:30Z on 6 September is still 17:30 on 5 September in Los Angeles (PDT, UTC-7).
    expect(localClockInTimeZone(new Date('2026-09-06T00:30:00.000Z'), 'America/Los_Angeles')).toEqual({
      date: '2026-09-05',
      minutes: 17 * 60 + 30,
    });
    expect(localClockInTimeZone(new Date('2026-04-27T05:30:00.000Z'), 'Asia/Dubai')).toEqual({
      date: '2026-04-27',
      minutes: 9 * 60 + 30,
    });
    expect(localClockInTimeZone(new Date('2026-04-27T00:05:00.000Z'), 'UTC')).toEqual({
      date: '2026-04-27',
      minutes: 5,
    });
    expect(localDateInTimeZone(new Date('2026-09-06T02:00:00.000Z'), 'America/Los_Angeles')).toBe('2026-09-05');
    expect(localDateInTimeZone(new Date('2026-09-06T02:00:00.000Z'), 'Asia/Dubai')).toBe('2026-09-06');
  });

  it('follows the zone data on the day daylight saving ends', () => {
    // Los Angeles leaves PDT at 2026-11-01T09:00Z, so the same local evening is one UTC hour later from then on.
    expect(localClockInTimeZone(new Date('2026-11-01T00:30:00.000Z'), 'America/Los_Angeles')).toEqual({
      date: '2026-10-31',
      minutes: 17 * 60 + 30,
    });
    expect(localClockInTimeZone(new Date('2026-11-02T00:30:00.000Z'), 'America/Los_Angeles')).toEqual({
      date: '2026-11-01',
      minutes: 16 * 60 + 30,
    });
    expect(localClockInTimeZone(new Date('2026-11-02T01:30:00.000Z'), 'America/Los_Angeles')).toEqual({
      date: '2026-11-01',
      minutes: 17 * 60 + 30,
    });
  });

  it('throws for a zone Intl cannot evaluate', () => {
    expect(() => localClockInTimeZone(new Date('2026-09-06T00:30:00.000Z'), 'Dubai')).toThrow();
  });

  it('evaluates plain windows inclusively and lets a window wrap past midnight', () => {
    const morning = { start: '09:00', end: '11:00' };
    expect(isInsideScheduleWindow(morning, 9 * 60)).toBe(true);
    expect(isInsideScheduleWindow(morning, 11 * 60)).toBe(true);
    expect(isInsideScheduleWindow(morning, 8 * 60 + 59)).toBe(false);
    expect(isInsideScheduleWindow(morning, 11 * 60 + 1)).toBe(false);

    const night = { start: '22:00', end: '06:00' };
    expect(isInsideScheduleWindow(night, 23 * 60)).toBe(true);
    expect(isInsideScheduleWindow(night, 60)).toBe(true);
    expect(isInsideScheduleWindow(night, 6 * 60)).toBe(true);
    expect(isInsideScheduleWindow(night, 12 * 60)).toBe(false);
  });

  it('assigns the small hours of a wrapping window to the day the window opened', () => {
    const night = { start: '22:00', end: '06:00' };
    expect(scheduleDayOf({ date: '2026-04-27', minutes: 60 + 30 }, night)).toBe('2026-04-26');
    expect(scheduleDayOf({ date: '2026-04-27', minutes: 23 * 60 }, night)).toBe('2026-04-27');
    expect(scheduleDayOf({ date: '2026-04-27', minutes: 12 * 60 }, night)).toBe('2026-04-27');
    expect(scheduleDayOf({ date: '2026-03-01', minutes: 30 }, night)).toBe('2026-02-28');
    expect(scheduleDayOf({ date: '2027-01-01', minutes: 30 }, night)).toBe('2026-12-31');
    // A plain window never moves the day.
    expect(scheduleDayOf({ date: '2026-04-27', minutes: 60 + 30 }, { start: '09:00', end: '11:00' })).toBe(
      '2026-04-27',
    );
  });
});
