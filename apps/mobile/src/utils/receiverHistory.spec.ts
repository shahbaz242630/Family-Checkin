import { describe, expect, it } from 'vitest';
import type { BackendReceiverCheckIn } from '../services/backendApi';
import {
  buildReceiverHistoryDays,
  checkInStatusDisplay,
  describeEscalation,
  formatLastHeardFrom,
  localDateKey,
  NEVER_HEARD_FROM_LABEL,
  shiftDateKey,
} from './receiverHistory';

function checkIn(overrides: Partial<BackendReceiverCheckIn> & { id: string }): BackendReceiverCheckIn {
  return {
    status: 'RESPONDED_OK',
    scheduledAt: '2026-09-07T05:00:00.000Z',
    escalations: [],
    ...overrides,
  } as BackendReceiverCheckIn;
}

describe('receiver local days (CB-036)', () => {
  it('uses the receivers own calendar day, not the senders', () => {
    // 22:30 UTC is already the next day in Dubai; the history row belongs to the receivers Tuesday.
    expect(localDateKey(new Date('2026-09-07T22:30:00.000Z'), 'Asia/Dubai')).toBe('2026-09-08');
    expect(localDateKey(new Date('2026-09-07T22:30:00.000Z'), 'Europe/London')).toBe('2026-09-07');
  });

  it('falls back to the UTC date when the timezone cannot be evaluated', () => {
    // A receiver saved with an unusable timezone is a known state (CB-069); the history must still render.
    expect(localDateKey(new Date('2026-09-07T10:00:00.000Z'), 'Dubai')).toBe('2026-09-07');
    expect(localDateKey(new Date('not a date'), 'Asia/Dubai')).toBe('');
  });

  it('walks calendar days backwards across month and year boundaries', () => {
    expect(shiftDateKey('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('receiver check-in history rows (CB-036)', () => {
  const endAt = new Date('2026-09-07T12:00:00.000Z');

  it('renders one row per day for the whole window, newest first', () => {
    const days = buildReceiverHistoryDays({ checkIns: [], timeZone: 'Asia/Dubai', days: 30, endAt });

    expect(days).toHaveLength(30);
    expect(days[0].date).toBe('2026-09-07');
    expect(days[29].date).toBe('2026-08-09');
  });

  it('says so on a day with no check-in, instead of leaving a gap', () => {
    const [today] = buildReceiverHistoryDays({ checkIns: [], timeZone: 'Asia/Dubai', days: 3, endAt });

    expect(today.status.label).toBe('No check-in');
    expect(today.detail).toBe('No check-in was scheduled.');
    expect(today.checkInIds).toEqual([]);
  });

  it('describes a day by its worst outcome and counts its escalations', () => {
    const days = buildReceiverHistoryDays({
      timeZone: 'Asia/Dubai',
      days: 2,
      endAt,
      checkIns: [
        checkIn({ id: 'ok', status: 'RESPONDED_OK', scheduledLocalDate: '2026-09-07' }),
        checkIn({
          id: 'help',
          status: 'RESPONDED_HELP',
          scheduledLocalDate: '2026-09-07',
          sentAt: '2026-09-07T05:01:00.000Z',
          respondedAt: '2026-09-07T05:04:00.000Z',
          escalations: [
            { id: 'e1', attemptNumber: 1, channel: 'SMS', startedAt: '2026-09-07T05:05:00.000Z' },
            { id: 'e2', attemptNumber: 2, channel: 'VOICE', startedAt: '2026-09-07T05:10:00.000Z' },
          ],
        }),
      ],
    });

    expect(days[0].status).toEqual({ label: 'Asked for help', tone: 'error' });
    expect(days[0].escalationCount).toBe(2);
    expect(days[0].escalations.map((escalation) => escalation.label)).toEqual([
      'Attempt 1 - SMS - in progress',
      'Attempt 2 - Voice - in progress',
    ]);
    expect(days[0].checkInIds).toEqual(['ok', 'help']);
    expect(days[0].detail).toContain('2 check-ins');
  });

  it('places a check-in without a local date on its day in the receivers timezone', () => {
    const days = buildReceiverHistoryDays({
      timeZone: 'Asia/Dubai',
      days: 3,
      endAt,
      // 21:00 UTC on the 6th is already the 7th in Dubai.
      checkIns: [checkIn({ id: 'late', status: 'RESPONDED_OK', scheduledAt: '2026-09-06T21:00:00.000Z' })],
    });

    expect(days[0].date).toBe('2026-09-07');
    expect(days[0].checkInIds).toEqual(['late']);
    expect(days[1].checkInIds).toEqual([]);
  });

  it('labels every check-in status a sender can meet', () => {
    expect(checkInStatusDisplay('RESPONDED_OK')).toEqual({ label: 'Answered OK', tone: 'success' });
    expect(checkInStatusDisplay('NEEDS_ATTENTION')).toEqual({ label: 'No answer', tone: 'error' });
    expect(checkInStatusDisplay('ESCALATED')).toEqual({ label: 'Backup alerted', tone: 'error' });
    expect(checkInStatusDisplay('SKIPPED')).toEqual({ label: 'Skipped', tone: 'muted' });
    expect(checkInStatusDisplay('SENT')).toEqual({ label: 'Awaiting reply', tone: 'warning' });
    expect(checkInStatusDisplay(undefined)).toEqual({ label: 'No check-in', tone: 'muted' });
    // A status this build has never seen still renders as words rather than as an enum.
    expect(checkInStatusDisplay('SOMETHING_NEW')).toEqual({ label: 'Something New', tone: 'muted' });
  });
});

describe('last heard from (CB-036)', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');

  it('says how long ago the receiver last answered', () => {
    expect(formatLastHeardFrom('2026-09-07T11:59:40.000Z', now)).toBe('Just now');
    expect(formatLastHeardFrom('2026-09-07T11:45:00.000Z', now)).toBe('15 minutes ago');
    expect(formatLastHeardFrom('2026-09-07T11:00:00.000Z', now)).toBe('1 hour ago');
    expect(formatLastHeardFrom('2026-09-06T09:00:00.000Z', now)).toBe('1 day ago');
    expect(formatLastHeardFrom('2026-09-02T09:00:00.000Z', now)).toBe('5 days ago');
  });

  it('falls back to a date once "N days ago" stops being useful', () => {
    expect(formatLastHeardFrom('2026-08-01T09:00:00.000Z', now)).not.toContain('ago');
  });

  it('is honest about a receiver who has never answered', () => {
    expect(formatLastHeardFrom(null, now)).toBe(NEVER_HEARD_FROM_LABEL);
    expect(formatLastHeardFrom(undefined, now)).toBe(NEVER_HEARD_FROM_LABEL);
    expect(formatLastHeardFrom('not a date', now)).toBe(NEVER_HEARD_FROM_LABEL);
  });

  it('never reads as a negative time when the device clock is ahead of the server', () => {
    expect(formatLastHeardFrom('2026-09-07T12:05:00.000Z', now)).toBe('Just now');
  });
});

describe('escalation lines (CB-036)', () => {
  const base = { id: 'e1', attemptNumber: 1, channel: 'SMS' as const, startedAt: '2026-09-07T05:05:00.000Z' };

  it('says which try, which channel and how it ended', () => {
    expect(describeEscalation({ ...base, result: 'SUCCESS' })).toBe('Attempt 1 - SMS - reached you');
    expect(describeEscalation({ ...base, attemptNumber: 2, channel: 'VOICE', result: 'NO_RESPONSE' })).toBe(
      'Attempt 2 - Voice - no response',
    );
    expect(describeEscalation({ ...base, result: 'ERROR' })).toBe('Attempt 1 - SMS - failed');
    expect(describeEscalation({ ...base, channel: 'WHATSAPP', result: 'SUCCESS' })).toBe(
      'Attempt 1 - WhatsApp - reached you',
    );
  });

  it('distinguishes an attempt still running from one that finished without a recorded result', () => {
    expect(describeEscalation(base)).toBe('Attempt 1 - SMS - in progress');
    expect(describeEscalation({ ...base, completedAt: '2026-09-07T05:06:00.000Z' })).toBe(
      'Attempt 1 - SMS - completed',
    );
  });
});
