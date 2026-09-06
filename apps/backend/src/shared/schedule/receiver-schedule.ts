/**
 * Validation for the two receiver fields the scheduler evaluates on every cron tick: `timezone` and
 * `scheduleTimeWindow`. Both used to be stored verbatim, and one receiver saved with `timezone: 'Dubai'` or
 * `{ start: '9:00' }` made `findReceiversDueForCheckIn` throw for every receiver (CB-004). The receivers service
 * rejects such values at create/update time and the check-ins repository uses the same rules to skip, rather
 * than trip over, any row that predates the validation.
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

function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && timeOfDayPattern.test(value);
}
