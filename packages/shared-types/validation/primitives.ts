/**
 * Request-body building blocks shared by the backend (through `ZodBodyPipe`) and the mobile app (CB-042).
 *
 * Nothing here may import from `@prisma/client` or from any Node built-in: the mobile app bundles these files
 * from source through its `@shared/*` path mapping, so they have to run under Hermes as well as under Node.
 * The enums are literal unions kept equal to the Prisma enums by the compile-time assertions in
 * `types/schema-alignment.spec.ts`.
 */
import { z } from 'zod';

/** `receivers.countryCode` / `backup_contacts` country hints are `char(2)`. */
export const COUNTRY_CODE_LENGTH = 2;
/** `receivers.language` is `varchar(8)`. */
export const MAX_LANGUAGE_CODE_LENGTH = 8;
/** Names are encrypted free text; the cap keeps one SMS segment's worth of rendering predictable. */
export const MAX_DISPLAY_NAME_LENGTH = 120;
/** What a phone field may carry before normalisation: `+971 50 123 4567` and friends. */
export const MAX_PHONE_INPUT_LENGTH = 32;
export const MAX_RELATIONSHIP_LABEL_LENGTH = 60;
export const MAX_LOCATION_INSTRUCTIONS_LENGTH = 500;
/** FR-REC-05: the sender's note travels inside the receiver's first message (CB-010). */
export const MAX_PERSONAL_NOTE_LENGTH = 50;
/** FR-CSC-06: the sender's resolution note, encrypted at rest (CB-018). */
export const MAX_RESOLUTION_NOTE_LENGTH = 200;
export const MAX_SCHEDULE_FREQUENCY_LENGTH = 32;
export const MAX_CRON_EXPRESSION_LENGTH = 120;
/** Ids travel in bodies only as opaque strings; the repositories scope every query by owner anyway. */
export const MAX_ID_LENGTH = 128;
/** An inbound reply body: one SMS is 160 characters, a concatenated one a few hundred. */
export const MAX_REPLY_BODY_LENGTH = 2000;
/** An Expo push token plus room for a future format. */
export const MAX_PUSH_TOKEN_LENGTH = 256;
export const MAX_DEVICE_ID_LENGTH = 128;

export const CHANNELS = ['WHATSAPP', 'SMS', 'VOICE'] as const;
export const TECH_PROFILES = ['WHATSAPP', 'SMS', 'VOICE_ONLY', 'LANDLINE'] as const;
export const RELATIONSHIP_TYPES = ['PARENT', 'GRANDPARENT', 'SIBLING', 'SPOUSE', 'CHILD', 'FRIEND', 'OTHER'] as const;
export const SENSITIVE_ACTIONS = ['EXPORT_DATA', 'DELETE_ACCOUNT', 'REMOVE_RECEIVER'] as const;
/** Validated at the API boundary rather than as a database enum, so a new platform is a code change (CB-023). */
export const PUSH_PLATFORMS = ['ios', 'android', 'web'] as const;

export const channelSchema = z.enum(CHANNELS);
export const techProfileSchema = z.enum(TECH_PROFILES);
export const relationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);
export const sensitiveActionSchema = z.enum(SENSITIVE_ACTIONS);
export const pushPlatformSchema = z.enum(PUSH_PLATFORMS);

/**
 * The cascade order after the primary channel. Bounded by the number of channels that exist so a client cannot
 * post a thousand-entry array; duplicates are the router's business, not the boundary's.
 */
export const fallbackChannelsSchema = z.array(channelSchema).max(CHANNELS.length);

/** Code points, not UTF-16 units: an emoji in a personal note counts once, as the services already count it. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** Trimmed, non-empty free text capped in code points. Encrypted columns have no length limit of their own. */
export function boundedText(max: number, label: string): z.ZodType<string, string> {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((value) => codePointLength(value) <= max, {
      message: `${label} must be ${max} characters or fewer`,
    });
}

/** Same bound, but an empty string is accepted and means "not provided" (the services treat blank as absent). */
export function optionalBoundedText(max: number, label: string): z.ZodType<string, string> {
  return z
    .string()
    .trim()
    .refine((value) => codePointLength(value) <= max, {
      message: `${label} must be ${max} characters or fewer`,
    });
}

export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Local time of day on a 24-hour clock, the format `receiver-schedule.ts` parses on every cron tick (CB-004). */
export const timeOfDaySchema = z.string().regex(TIME_OF_DAY_PATTERN, 'must use HH:mm (24-hour) format');

export const scheduleTimeWindowSchema = z.object({
  start: timeOfDaySchema,
  end: timeOfDaySchema,
});

/**
 * True when `value` names a time zone `Intl.DateTimeFormat` can evaluate — the same test the scheduler applies
 * (`isSupportedTimeZone` in the backend's `shared/schedule/receiver-schedule.ts`), written without
 * `Intl.supportedValuesOf` so it also runs on a mobile runtime that does not ship it. A receiver saved with
 * `timezone: 'Dubai'` used to break the cron tick for every other receiver (CB-004).
 */
export function isIanaTimeZone(value: string): boolean {
  if (!value || !/^[A-Za-z][A-Za-z0-9+_-]*(?:\/[A-Za-z0-9+_-]+)*$/.test(value)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().trim().refine(isIanaTimeZone, {
  message: 'timezone must be an IANA time zone name such as Asia/Dubai',
});

/** ISO 3166-1 alpha-2, upper-cased; the column is `char(2)` and a longer value used to fail inside Postgres. */
export const countryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'countryCode must be a two-letter ISO 3166-1 country code')
  .transform((value) => value.toUpperCase());

/** BCP-47-ish tag as the catalog stores it (`en`, `en-GB`, `ar`). */
export const languageCodeSchema = z
  .string()
  .trim()
  .min(2, 'language is required')
  .max(MAX_LANGUAGE_CODE_LENGTH)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,4})?$/, 'language must be a language tag such as en or en-GB');

export const E164_PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * A phone number already in E.164. Used where the value comes from a provider or from our own storage, never
 * for a number a person typed.
 */
export const e164PhoneSchema = z
  .string()
  .trim()
  .regex(E164_PHONE_PATTERN, 'phone must be in E.164 format, for example +971501234567');

/**
 * A phone number as a sender typed it. The app sends the dial code and the national number as one string, which
 * `normalizePhone` (libphonenumber) turns into E.164 together with `phoneCountry`, so this only rejects what
 * could never be a phone number; libphonenumber still has the final say and answers 400 `Invalid phone number`.
 */
export const dialablePhoneSchema = z
  .string()
  .trim()
  .min(1, 'phone is required')
  .max(MAX_PHONE_INPUT_LENGTH)
  .regex(/^\+?[\d\s().-]+$/, 'phone may contain only digits, spaces and + ( ) - .')
  .refine((value) => (value.match(/\d/g)?.length ?? 0) >= 6, {
    message: 'phone must contain at least 6 digits',
  })
  // A number that already claims to be international has to be E.164 once the separators a person types are
  // removed; a national number is left to libphonenumber and `phoneCountry`.
  .refine((value) => !value.startsWith('+') || E164_PHONE_PATTERN.test(stripPhoneSeparators(value)), {
    message: 'phone must be in E.164 format, for example +971501234567',
  });

/** Spaces and the punctuation a person types between groups of digits. */
export function stripPhoneSeparators(value: string): string {
  return value.replace(/[\s().-]/g, '');
}

/** An opaque identifier posted in a body (never a route parameter, which the repositories scope by owner). */
export const identifierSchema = z.string().trim().min(1).max(MAX_ID_LENGTH);

/** An ISO-8601 instant a client may post; the controller turns it into a `Date`. */
export const isoDateTimeSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: 'must be a valid ISO-8601 date',
  });
