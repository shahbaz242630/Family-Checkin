import { describe, expect, it } from 'vitest';
import { formatOffsetMinutes, formatUtcOffsetLabel, parseShortOffsetName, utcOffsetMinutes } from './timezoneOffset';

const SUMMER = new Date('2026-07-15T12:00:00.000Z');
const WINTER = new Date('2026-01-15T12:00:00.000Z');

describe('formatUtcOffsetLabel', () => {
  it('shows London as UTC+1 in summer and UTC+0 in winter, from the IANA zone rather than a fixed label', () => {
    expect(formatUtcOffsetLabel('Europe/London', SUMMER)).toBe('UTC+1');
    expect(formatUtcOffsetLabel('Europe/London', WINTER)).toBe('UTC+0');
  });

  it('handles zones with and without daylight saving, negative offsets and half or quarter hours', () => {
    expect(formatUtcOffsetLabel('Asia/Dubai', SUMMER)).toBe('UTC+4');
    expect(formatUtcOffsetLabel('Asia/Dubai', WINTER)).toBe('UTC+4');
    expect(formatUtcOffsetLabel('Asia/Kolkata', SUMMER)).toBe('UTC+5:30');
    expect(formatUtcOffsetLabel('Asia/Kathmandu', SUMMER)).toBe('UTC+5:45');
    expect(formatUtcOffsetLabel('America/New_York', WINTER)).toBe('UTC-5');
    expect(formatUtcOffsetLabel('America/New_York', SUMMER)).toBe('UTC-4');
    expect(formatUtcOffsetLabel('Australia/Sydney', WINTER)).toBe('UTC+11');
    expect(formatUtcOffsetLabel('Australia/Sydney', SUMMER)).toBe('UTC+10');
    expect(formatUtcOffsetLabel('UTC', SUMMER)).toBe('UTC+0');
  });

  it('returns the fallback when Intl cannot format the zone', () => {
    expect(formatUtcOffsetLabel('Not/A_Zone', SUMMER, 'UTC+0')).toBe('UTC+0');
    expect(formatUtcOffsetLabel('', SUMMER, 'static label')).toBe('static label');
    expect(formatUtcOffsetLabel('Not/A_Zone', SUMMER)).toBe('Not/A_Zone');
  });
});

describe('utcOffsetMinutes', () => {
  it('computes the offset from the wall clock, so it works without shortOffset support', () => {
    expect(utcOffsetMinutes('Europe/London', SUMMER)).toBe(60);
    expect(utcOffsetMinutes('Europe/London', WINTER)).toBe(0);
    expect(utcOffsetMinutes('Asia/Kolkata', SUMMER)).toBe(330);
    expect(utcOffsetMinutes('America/Los_Angeles', WINTER)).toBe(-480);
    expect(utcOffsetMinutes('Pacific/Auckland', WINTER)).toBe(780);
  });

  it('is exact at midnight and across a date boundary', () => {
    expect(utcOffsetMinutes('Asia/Tokyo', new Date('2026-03-01T15:00:00.000Z'))).toBe(540);
    expect(utcOffsetMinutes('America/Sao_Paulo', new Date('2026-03-01T02:30:00.000Z'))).toBe(-180);
    expect(utcOffsetMinutes('Europe/London', new Date('2026-07-15T12:00:00.789Z'))).toBe(60);
  });

  it('is undefined for a zone Intl rejects', () => {
    expect(utcOffsetMinutes('Not/A_Zone', SUMMER)).toBeUndefined();
  });
});

describe('parseShortOffsetName', () => {
  it('normalises Intl shortOffset names to UTC labels', () => {
    expect(parseShortOffsetName('GMT+1')).toBe('UTC+1');
    expect(parseShortOffsetName('GMT')).toBe('UTC+0');
    expect(parseShortOffsetName('GMT+0')).toBe('UTC+0');
    expect(parseShortOffsetName('GMT+5:30')).toBe('UTC+5:30');
    expect(parseShortOffsetName('GMT-5')).toBe('UTC-5');
    expect(parseShortOffsetName('GMT+05:45')).toBe('UTC+5:45');
    expect(parseShortOffsetName('UTC+4')).toBe('UTC+4');
    expect(parseShortOffsetName('GMT+1:00')).toBe('UTC+1');
  });

  it('rejects abbreviations a runtime without shortOffset might return', () => {
    expect(parseShortOffsetName('BST')).toBeUndefined();
    expect(parseShortOffsetName('GST')).toBeUndefined();
    expect(parseShortOffsetName('British Summer Time')).toBeUndefined();
    expect(parseShortOffsetName(undefined)).toBeUndefined();
    expect(parseShortOffsetName('')).toBeUndefined();
  });
});

describe('formatOffsetMinutes', () => {
  it('formats whole hours, half hours and negative offsets', () => {
    expect(formatOffsetMinutes(0)).toBe('UTC+0');
    expect(formatOffsetMinutes(60)).toBe('UTC+1');
    expect(formatOffsetMinutes(330)).toBe('UTC+5:30');
    expect(formatOffsetMinutes(345)).toBe('UTC+5:45');
    expect(formatOffsetMinutes(-300)).toBe('UTC-5');
    expect(formatOffsetMinutes(-210)).toBe('UTC-3:30');
    expect(formatOffsetMinutes(780)).toBe('UTC+13');
  });
});
