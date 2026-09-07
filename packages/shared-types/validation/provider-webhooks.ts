/**
 * Bodies of the Twilio webhooks (CB-042) — deliberately the most permissive schemas in this folder.
 *
 * Twilio posts `application/x-www-form-urlencoded` and signs the request URL followed by **every** POST
 * parameter, sorted. Dropping or rewriting a field we do not know about would change the string the controller
 * hashes and turn a genuine Twilio request into a 401, so these schemas are loose objects: unknown fields
 * survive untouched, the fields the controller reads are checked to be strings, and nothing is required.
 * A payload that is not an object at all is still refused.
 */
import { z } from 'zod';

/** Twilio form fields arrive as strings; the length cap only stops an absurd body. */
const twilioField = z.string().max(4096).optional();

export const twilioMessagingWebhookBodySchema = z.looseObject({
  From: twilioField,
  Body: twilioField,
  ButtonText: twilioField,
  ButtonPayload: twilioField,
  MessageSid: twilioField,
});

export const twilioMessagingStatusWebhookBodySchema = z.looseObject({
  MessageSid: twilioField,
  MessageStatus: twilioField,
  ErrorCode: twilioField,
  To: twilioField,
  From: twilioField,
});

export const twilioVoiceWebhookBodySchema = z.looseObject({
  From: twilioField,
  To: twilioField,
  Digits: twilioField,
  SpeechResult: twilioField,
  CallSid: twilioField,
});

export const twilioVoiceStatusWebhookBodySchema = z.looseObject({
  CallSid: twilioField,
  CallStatus: twilioField,
  CallDuration: twilioField,
  From: twilioField,
  To: twilioField,
});

export const twilioVoiceAmdWebhookBodySchema = z.looseObject({
  CallSid: twilioField,
  AnsweredBy: twilioField,
  From: twilioField,
  To: twilioField,
});

export type TwilioMessagingWebhookBody = z.infer<typeof twilioMessagingWebhookBodySchema>;
export type TwilioMessagingStatusWebhookBody = z.infer<typeof twilioMessagingStatusWebhookBodySchema>;
export type TwilioVoiceWebhookBody = z.infer<typeof twilioVoiceWebhookBodySchema>;
export type TwilioVoiceStatusWebhookBody = z.infer<typeof twilioVoiceStatusWebhookBodySchema>;
export type TwilioVoiceAmdWebhookBody = z.infer<typeof twilioVoiceAmdWebhookBodySchema>;
