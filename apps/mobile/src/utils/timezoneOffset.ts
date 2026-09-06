// UTC offset labels computed from an IANA zone at render time, so London reads "UTC+1" in summer and "UTC+0" in
// winter instead of a fixed label (CB-073). Two strategies, both built on Intl.DateTimeFormat's timeZone support:
// the `shortOffset` name when the runtime produces one, else the wall-clock difference. Neither trusts a static
// table; when Intl cannot format the zone at all, the caller's fallback label is returned.

const SHORT_OFFSET_NAME = /^(?:GMT|UTC)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/;

/** `GMT+1` -> `UTC+1`, `GMT` -> `UTC+0`, `GMT+5:30` -> `UTC+5:30`; anything else (for example `BST`) -> undefined. */
export function parseShortOffsetName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const match = name.trim().match(SHORT_OFFSET_NAME);
  if (!match) return undefined;
  const [, sign, hours, minutes] = match;
  if (!sign) return 'UTC+0';
  const hourPart = Number(hours);
  const minutePart = minutes && minutes !== '00' ? `:${minutes}` : '';
  if (hourPart === 0 && !minutePart) return 'UTC+0';
  return `UTC${sign}${hourPart}${minutePart}`;
}

/** `60` -> `UTC+1`, `-300` -> `UTC-5`, `330` -> `UTC+5:30`, `0` -> `UTC+0`. */
export function formatOffsetMinutes(offsetMinutes: number): string {
  const rounded = Math.round(offsetMinutes);
  const sign = rounded < 0 ? '-' : '+';
  const absolute = Math.abs(rounded);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `UTC${sign}${hours}${minutes ? `:${minutes.toString().padStart(2, '0')}` : ''}`;
}

function shortOffsetFromIntl(timeZone: string, at: Date): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at);
    return parseShortOffsetName(parts.find((part) => part.type === 'timeZoneName')?.value);
  } catch {
    return undefined;
  }
}

/**
 * The zone's offset from UTC in minutes at `at`, computed from the wall-clock time Intl reports for the zone.
 * Undefined when the runtime cannot format the zone.
 */
export function utcOffsetMinutes(timeZone: string, at: Date = new Date()): number | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);
    const read = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value);
    const wallClockAsUtc = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour') % 24,
      read('minute'),
      read('second'),
    );
    if (Number.isNaN(wallClockAsUtc)) return undefined;
    // Intl parts carry whole seconds, so compare against the instant truncated to the second.
    const instant = Math.floor(at.getTime() / 1000) * 1000;
    return Math.round((wallClockAsUtc - instant) / 60_000);
  } catch {
    return undefined;
  }
}

/**
 * `UTC+1`-style label for `timeZone` at the given instant. Falls back to `fallback` (default: the zone id) when
 * Intl cannot format the zone.
 */
export function formatUtcOffsetLabel(timeZone: string, at: Date = new Date(), fallback: string = timeZone): string {
  const fromShortOffset = shortOffsetFromIntl(timeZone, at);
  if (fromShortOffset) return fromShortOffset;

  const minutes = utcOffsetMinutes(timeZone, at);
  if (minutes !== undefined) return formatOffsetMinutes(minutes);

  return fallback;
}
