import { describe, expect, it } from 'vitest';
import {
  describePauseUntil,
  INDEFINITE_PAUSE_DETAIL,
  INDEFINITE_PAUSED_UNTIL,
  isIndefinitePause,
  pauseUntilOptions,
} from './receiverPause';

const now = new Date('2026-09-07T12:00:00.000Z');

describe('pause end dates (CB-036)', () => {
  it('offers end dates resolved against the moment the sender opens it', () => {
    const options = pauseUntilOptions(now);

    expect(options.map((option) => option.key)).toEqual(['1d', '3d', '1w', '2w', '1m', 'indefinite']);
    expect(options.find((option) => option.key === '1w')?.pausedUntil).toBe('2026-09-14T12:00:00.000Z');
    expect(options.find((option) => option.key === '1d')?.pausedUntil).toBe('2026-09-08T12:00:00.000Z');
    expect(options.find((option) => option.key === '1m')?.pausedUntil).toBe('2026-10-07T12:00:00.000Z');
  });

  it('keeps the indefinite pause as an option with no end date to send', () => {
    const indefinite = pauseUntilOptions(now).at(-1);

    // No `pausedUntil` at all: the backend applies its own sentinel, which is the pre-CB-036 behaviour.
    expect(indefinite).toMatchObject({ key: 'indefinite', detail: INDEFINITE_PAUSE_DETAIL });
    expect(indefinite?.pausedUntil).toBeUndefined();
  });

  it('recognises the backend sentinel as an open-ended pause', () => {
    expect(isIndefinitePause(INDEFINITE_PAUSED_UNTIL)).toBe(true);
    // The abuse-review pause uses its own far-future date; a sender reads that as open-ended too.
    expect(isIndefinitePause('9999-12-31T00:00:00.000Z')).toBe(true);
    expect(isIndefinitePause('2026-09-14T12:00:00.000Z')).toBe(false);
    expect(isIndefinitePause(null)).toBe(false);
    expect(isIndefinitePause(undefined)).toBe(false);
  });

  it('says when check-ins come back, or that the sender has to resume them', () => {
    expect(describePauseUntil(INDEFINITE_PAUSED_UNTIL)).toBe('Paused until you resume check-ins.');
    expect(describePauseUntil(undefined)).toBe('Paused until you resume check-ins.');
    expect(describePauseUntil('not a date')).toBe('Paused until you resume check-ins.');
    expect(describePauseUntil('2026-09-14T12:00:00.000Z')).toContain('Check-ins start again on their own');
  });
});
