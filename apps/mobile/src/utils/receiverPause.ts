/**
 * End dates for "Pause check-ins" (CB-036, FR-REC-07).
 *
 * `PATCH /receivers/:id/pause` has always taken an optional `pausedUntil`, but the app only ever sent the
 * indefinite pause, so a sender who paused for a holiday had to remember to resume. Expo SDK 54 ships no date
 * picker and this package must not grow a dependency for one, so the choice is a list of end dates built from
 * the moment the sender opens it — which is also the better control here: nobody pauses "until 14 September",
 * they pause "for a week".
 */

/** The sentinel the backend stores for a pause with no end date. */
export const INDEFINITE_PAUSED_UNTIL = '9999-12-31T23:59:59.999Z';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PauseUntilOption {
  /** Stable key for the list; also what a spec asserts on. */
  key: string;
  /** "For 1 week" — the choice itself. */
  label: string;
  /** "Until Mon 14 Sep" — the date that choice resolves to, or the indefinite wording. */
  detail: string;
  /** What the app sends as `pausedUntil`; absent means the indefinite pause (no body field at all). */
  pausedUntil?: string;
}

const PRESET_DAYS: { key: string; label: string; days: number }[] = [
  { key: '1d', label: 'For 1 day', days: 1 },
  { key: '3d', label: 'For 3 days', days: 3 },
  { key: '1w', label: 'For 1 week', days: 7 },
  { key: '2w', label: 'For 2 weeks', days: 14 },
  { key: '1m', label: 'For 1 month', days: 30 },
];

export const INDEFINITE_PAUSE_DETAIL = 'Until you resume it yourself';

/** The end dates offered, resolved against `now` so every label names a real date. */
export function pauseUntilOptions(now: Date): PauseUntilOption[] {
  const presets = PRESET_DAYS.map(({ key, label, days }) => {
    const until = new Date(now.getTime() + days * MILLISECONDS_PER_DAY);
    return { key, label, detail: `Until ${formatPauseDate(until)}`, pausedUntil: until.toISOString() };
  });

  return [...presets, { key: 'indefinite', label: 'Until I resume', detail: INDEFINITE_PAUSE_DETAIL }];
}

/** True for the sentinel the backend writes when a pause has no end date. */
export function isIndefinitePause(pausedUntil?: string | null): boolean {
  if (!pausedUntil) {
    return false;
  }

  const parsed = new Date(pausedUntil);
  // Any far-future date is indefinite in practice; the abuse-review pause uses a different sentinel again.
  return Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() >= 9999;
}

/** The sentence shown on a paused receiver: when check-ins come back, or that the sender has to resume them. */
export function describePauseUntil(pausedUntil?: string | null): string {
  if (!pausedUntil || isIndefinitePause(pausedUntil)) {
    return 'Paused until you resume check-ins.';
  }

  const parsed = new Date(pausedUntil);
  if (Number.isNaN(parsed.getTime())) {
    return 'Paused until you resume check-ins.';
  }

  return `Paused until ${formatPauseDate(parsed)}. Check-ins start again on their own after that.`;
}

function formatPauseDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
