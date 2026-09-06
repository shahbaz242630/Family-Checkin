/**
 * Route Twilio posts message delivery statuses to (`ProviderWebhooksController.handleTwilioMessagingStatusWebhook`).
 * The signature Twilio computes covers the full URL, so this path and `PUBLIC_API_BASE_URL` must match the
 * controller's `assertTwilioSignature` path exactly (CB-016).
 */
export const TWILIO_MESSAGING_STATUS_CALLBACK_PATH = '/provider-webhooks/twilio/messaging/status';

/**
 * The `StatusCallback` URL for an outbound SMS or WhatsApp message, or `undefined` when `PUBLIC_API_BASE_URL` is
 * not configured: Twilio must never be pointed at a guessed host, and a missing callback only means an
 * undelivered message is discovered by the response-window timeout instead of within seconds.
 */
export function twilioMessagingStatusCallbackUrl(publicApiBaseUrl: string | undefined): string | undefined {
  const base = publicApiBaseUrl?.trim().replace(/\/$/, '');
  return base ? `${base}${TWILIO_MESSAGING_STATUS_CALLBACK_PATH}` : undefined;
}
