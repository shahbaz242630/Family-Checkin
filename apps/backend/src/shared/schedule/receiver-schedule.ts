/**
 * Validation and local-clock arithmetic for the two receiver fields the scheduler evaluates on every cron tick:
 * `timezone` and `scheduleTimeWindow`. Both used to be stored verbatim, and one receiver saved with
 * `timezone: 'Dubai'` or `{ start: '9:00' }` made `findReceiversDueForCheckIn` throw for every receiver (CB-004).
 * The receivers service rejects such values at create/update time and the check-ins repository uses the same
 * rules to skip, rather than trip over, any row that predates the validation.
 */
export type ReceiverScheduleValidationCode = 'INVALID_TIMEZONE' | 'INVALID_SCHEDULE_TIME_WINDOW';

export class ReceiverScheduleValidationError extends Error {
  constructor(
    public readonly code: ReceiverScheduleValidationCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReceiverScheduleValidationError';
  }
}

/** A type alias rather than an interface so it is assignable to Prisma's JSON input types. */
export type ScheduleTimeWindow = {
  /** Local time of day in `HH:mm`, 24-hour clock. */
  start: string;
  end: string;
};

/** A receiver's wall clock at one instant: the local calendar date as `YYYY-MM-DD` and minutes since local midnight. */
export interface LocalClock {
  date: string;
  minutes: number;
}

const timeOfDayPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

let canonicalTimeZones: Set<string> | undefined;

/**
 * True when `value` names a time zone `Intl.DateTimeFormat` can evaluate. `Intl.supportedValuesOf('timeZone')` is
 * the fast path, but it lists only canonical IANA zones and leaves out links such as `UTC` and `Asia/Calcutta`
 * that the formatter (and therefore the scheduler) accepts, so anything not on the list is tried directly.
 */
export function isSupportedTimeZone(value: string): boolean {
  if (!value) {
    return false;
  }

  canonicalTimeZones ??= new Set(Intl.supportedValuesOf('timeZone'));
  if (canonicalTimeZones.has(value)) {
    return true;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function assertSupportedTimeZone(value: string): void {
  if (!isSupportedTimeZone(value)) {
    throw new ReceiverScheduleValidationError(
      'INVALID_TIMEZONE',
      'Receiver timezone must be an IANA time zone name such as Asia/Dubai',
    );
  }
}

/** Parses a posted or stored `scheduleTimeWindow`: an object whose `start` and `end` are `HH:mm` strings. */
export function parseScheduleTimeWindow(value: unknown): ScheduleTimeWindow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReceiverScheduleValidationError(
      'INVALID_SCHEDULE_TIME_WINDOW',
      'Receiver schedule time window must be an object with start and end times',
    );
  }

  const { start, end } = value as { start?: unknown; end?: unknown };
  if (!isTimeOfDay(start) || !isTimeOfDay(end)) {
    throw new ReceiverScheduleValidationError(
      'INVALID_SCHEDULE_TIME_WINDOW',
      'Receiver schedule time window start and end must use HH:mm (24-hour) format',
    );
  }

  return { start, end };
}

/** Minutes since local midnight for a validated `HH:mm` value. */
export function timeOfDayToMinutes(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Reads the local date and time of `instant` in an IANA zone with one `Intl` formatter call, so daylight-saving
 * changes and zones on the far side of UTC midnight come from the platform's zone data rather than from offset
 * arithmetic. Throws when the zone cannot be evaluated; callers validate with `assertSupportedTimeZone` first.
 */
export function localClockInTimeZone(instant: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  const year = read('year');
  const month = read('month');
  const day = read('day');
  const hour = read('hour');
  const minute = read('minute');
  if (![year, month, day, hour, minute].every(Number.isInteger)) {
    throw new Error(`Could not resolve local time for timezone ${timeZone}`);
  }

  return {
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    minutes: hour * 60 + minute,
  };
}

/** The local calendar date (`YYYY-MM-DD`) of `instant` in an IANA zone. */
export function localDateInTimeZone(instant: Date, timeZone: string): string {
  return localClockInTimeZone(instant, timeZone).date;
}

/** True when the local time is inside the window (inclusive); a window whose start is after its end wraps past midnight. */
export function isInsideScheduleWindow(window: ScheduleTimeWindow, minutesSinceMidnight: number): boolean {
  const start = timeOfDayToMinutes(window.start);
  const end = timeOfDayToMinutes(window.end);
  if (start <= end) {
    return minutesSinceMidnight >= start && minutesSinceMidnight <= end;
  }

  return minutesSinceMidnight >= start || minutesSinceMidnight <= end;
}

/**
 * The schedule day (`YYYY-MM-DD`) a check-in created at `clock` belongs to: the receiver's local calendar date,
 * except that the small hours of a window that wraps past midnight (`22:00`-`06:00`) still belong to the day the
 * window opened, so one open window never yields two check-ins (CB-013).
 */
export function scheduleDayOf(clock: LocalClock, window: ScheduleTimeWindow): string {
  const start = timeOfDayToMinutes(window.start);
  const end = timeOfDayToMinutes(window.end);
  if (start > end && clock.minutes <= end) {
    return previousCalendarDate(clock.date);
  }

  return clock.date;
}

function previousCalendarDate(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && timeOfDayPattern.test(value);
}
