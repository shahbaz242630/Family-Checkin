// Options for the check-in window pickers. Quarter-hour steps keep the list to 96 rows (CB-073) while a
// value saved at another minute (an older receiver, an API-created one) is still shown and selectable.
export const DEFAULT_MINUTE_STEP = 15;

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_PATTERN.test(value);
}

function normaliseStep(minuteStep: number): number {
  return Number.isInteger(minuteStep) && minuteStep >= 1 && minuteStep <= 60 ? minuteStep : DEFAULT_MINUTE_STEP;
}

/**
 * Every `HH:mm` on the given minute step, ascending, plus `includeValue` in its sorted position when it is a valid
 * time that does not fall on the step. An invalid `includeValue` is ignored.
 */
export function buildTimeOptions(minuteStep: number = DEFAULT_MINUTE_STEP, includeValue?: string): string[] {
  const step = normaliseStep(minuteStep);
  const options: string[] = [];

  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += step) {
      options.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
    }
  }

  if (includeValue && isValidTimeOfDay(includeValue) && !options.includes(includeValue)) {
    // Zero-padded HH:mm sorts correctly as a string.
    const insertAt = options.findIndex((option) => option > includeValue);
    options.splice(insertAt === -1 ? options.length : insertAt, 0, includeValue);
  }

  return options;
}
