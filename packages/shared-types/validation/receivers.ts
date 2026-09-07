/** Bodies of the `/receivers` and `/receiver-replies` routes (CB-042). */
import { z } from 'zod';
import {
  boundedText,
  channelSchema,
  countryCodeSchema,
  dialablePhoneSchema,
  fallbackChannelsSchema,
  identifierSchema,
  isoDateTimeSchema,
  languageCodeSchema,
  MAX_CRON_EXPRESSION_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PERSONAL_NOTE_LENGTH,
  MAX_PHONE_INPUT_LENGTH,
  MAX_REPLY_BODY_LENGTH,
  MAX_RESOLUTION_NOTE_LENGTH,
  MAX_SCHEDULE_FREQUENCY_LENGTH,
  optionalBoundedText,
  relationshipTypeSchema,
  scheduleTimeWindowSchema,
  techProfileSchema,
  timeZoneSchema,
} from './primitives';

/**
 * How often check-ins go out. Only `daily` is scheduled today (`findReceiversDueForCheckIn` filters on it), so
 * this stays a bounded string rather than an enum: a value the scheduler ignores must not make an existing
 * receiver uneditable.
 */
const scheduleFrequencySchema = z
  .string()
  .trim()
  .min(1, 'scheduleFrequency is required')
  .max(MAX_SCHEDULE_FREQUENCY_LENGTH);

/** The fields create and update share; phone and the personal note are create-only (phone is not editable). */
const receiverProfileShape = {
  name: boundedText(MAX_DISPLAY_NAME_LENGTH, 'name'),
  countryCode: countryCodeSchema,
  relationshipType: relationshipTypeSchema,
  language: languageCodeSchema,
  timezone: timeZoneSchema,
  techProfile: techProfileSchema,
  primaryChannel: channelSchema,
  fallbackChannels: fallbackChannelsSchema.default([]),
  scheduleFrequency: scheduleFrequencySchema,
  scheduleTimeWindow: scheduleTimeWindowSchema,
  scheduleCustomCron: z.string().trim().max(MAX_CRON_EXPRESSION_LENGTH).optional(),
};

export const createReceiverBodySchema = z.object({
  ...receiverProfileShape,
  phone: dialablePhoneSchema,
  /** Default region for a national number; the receiver's own country when absent. */
  phoneCountry: countryCodeSchema.optional(),
  personalNote: optionalBoundedText(MAX_PERSONAL_NOTE_LENGTH, 'personalNote').optional(),
});

export const updateReceiverBodySchema = z.object(receiverProfileShape);

export const pauseReceiverBodySchema = z.object({
  /** Absent means the indefinite sentinel the receivers service applies. */
  pausedUntil: isoDateTimeSchema.optional(),
});

export const resolveCheckInBodySchema = z.object({
  note: optionalBoundedText(MAX_RESOLUTION_NOTE_LENGTH, 'note').optional(),
});

/**
 * `POST /receiver-replies/fake`, the fake-mode-only test route. `fromPhone` is deliberately not E.164: the
 * reply pipeline answers 201 `invalid_sender` for a short code or an unparseable number and that behaviour is
 * part of the acceptance run (an inbound reply must never fail loudly, CB-015).
 */
export const fakeInboundReceiverReplyBodySchema = z.object({
  fromPhone: z.string().trim().min(1, 'fromPhone is required').max(MAX_PHONE_INPUT_LENGTH),
  channel: channelSchema,
  body: z.string().max(MAX_REPLY_BODY_LENGTH),
  providerMessageId: identifierSchema.optional(),
});

export type CreateReceiverBody = z.infer<typeof createReceiverBodySchema>;
export type UpdateReceiverBody = z.infer<typeof updateReceiverBodySchema>;
export type PauseReceiverBody = z.infer<typeof pauseReceiverBodySchema>;
export type ResolveCheckInBody = z.infer<typeof resolveCheckInBodySchema>;
export type FakeInboundReceiverReplyBody = z.infer<typeof fakeInboundReceiverReplyBodySchema>;
