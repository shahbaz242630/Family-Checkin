import { describe, expect, it } from 'vitest';
import { DEFAULT_MINUTE_STEP, buildTimeOptions, isValidTimeOfDay } from './timeOptions';

describe('buildTimeOptions', () => {
  it('offers quarter-hour steps by default: 96 rows from 00:00 to 23:45', () => {
    const options = buildTimeOptions();

    expect(DEFAULT_MINUTE_STEP).toBe(15);
    expect(options).toHaveLength(96);
    expect(options[0]).toBe('00:00');
    expect(options[options.length - 1]).toBe('23:45');
    expect(options.slice(36, 40)).toEqual(['09:00', '09:15', '09:30', '09:45']);
    expect(options).toContain('18:00');
    expect(options).not.toContain('18:01');
  });

  it('honours an explicit step', () => {
    expect(buildTimeOptions(1)).toHaveLength(1440);
    expect(buildTimeOptions(30)).toHaveLength(48);
    expect(buildTimeOptions(60)).toEqual(
      Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, '0')}:00`),
    );
  });

  it('falls back to the default step for a step that is not a whole number of minutes in 1..60', () => {
    expect(buildTimeOptions(0)).toHaveLength(96);
    expect(buildTimeOptions(-5)).toHaveLength(96);
    expect(buildTimeOptions(61)).toHaveLength(96);
    expect(buildTimeOptions(7.5)).toHaveLength(96);
    expect(buildTimeOptions(Number.NaN)).toHaveLength(96);
  });

  it('keeps a loaded value that is not on the step, in sorted position, so it still displays', () => {
    const options = buildTimeOptions(15, '09:20');

    expect(options).toHaveLength(97);
    expect(options.slice(36, 41)).toEqual(['09:00', '09:15', '09:20', '09:30', '09:45']);
    expect(buildTimeOptions(15, '23:59').at(-1)).toBe('23:59');
    expect(buildTimeOptions(15, '00:01').slice(0, 2)).toEqual(['00:00', '00:01']);
  });

  it('does not duplicate a loaded value that is already on the step', () => {
    expect(buildTimeOptions(15, '09:15')).toHaveLength(96);
    expect(buildTimeOptions(15, '09:15').filter((option) => option === '09:15')).toHaveLength(1);
  });

  it('ignores a loaded value that is not a valid HH:mm', () => {
    expect(buildTimeOptions(15, '')).toHaveLength(96);
    expect(buildTimeOptions(15, '9:20')).toHaveLength(96);
    expect(buildTimeOptions(15, '24:00')).toHaveLength(96);
    expect(buildTimeOptions(15, '09:60')).toHaveLength(96);
    expect(buildTimeOptions(15, 'noon')).toHaveLength(96);
  });
});

describe('isValidTimeOfDay', () => {
  it('accepts zero-padded 24-hour HH:mm only', () => {
    expect(isValidTimeOfDay('00:00')).toBe(true);
    expect(isValidTimeOfDay('23:59')).toBe(true);
    expect(isValidTimeOfDay('09:20')).toBe(true);
    expect(isValidTimeOfDay('9:20')).toBe(false);
    expect(isValidTimeOfDay('24:00')).toBe(false);
    expect(isValidTimeOfDay('12:60')).toBe(false);
    expect(isValidTimeOfDay('12:00:00')).toBe(false);
    expect(isValidTimeOfDay('')).toBe(false);
  });
});
