# Provider Webhook Adapter Design

## Goal

Add provider-shaped inbound webhook endpoints for WhatsApp and SMS without changing receiver reply business logic.

## Design

- Keep existing `ReceiverReplyService.handleInboundReply` as the single normalized reply path.
- Add edge controllers that parse provider payloads into:
  - `fromPhone`
  - `channel`
  - `body`
  - optional `providerMessageId`
  - optional `providerReceivedAt`
  - request IP and user agent
- Protect callbacks with `CHANNEL_WEBHOOK_SECRET` through `x-nearby-webhook-secret`.
- Return aggregate processing counts only.
- Do not echo provider payloads, message bodies, phone numbers, names, transcripts, or encrypted content.

## Endpoints

- `POST /provider-webhooks/whatsapp`
- `POST /provider-webhooks/sms`
- `POST /provider-webhooks/twilio/messaging`
- `POST /provider-webhooks/twilio/voice`

## Twilio Direction

The selected vendor for phone calls, SMS, and WhatsApp is Twilio. Twilio messaging webhooks are used for both SMS and WhatsApp inbound replies. WhatsApp sender addresses use the `whatsapp:+E164` prefix; SMS sender addresses use plain E.164. Voice replies are normalized from `Digits` first, then `SpeechResult`.

Twilio endpoints validate `X-Twilio-Signature` with `TWILIO_AUTH_TOKEN`, `PUBLIC_API_BASE_URL`, the endpoint path, and all submitted form parameters.

Outbound configured providers also use Twilio:

- SMS and WhatsApp use Twilio `Messages.json`.
- WhatsApp addresses are sent as `whatsapp:+E164`.
- Voice calls use Twilio `Calls.json` with inline TwiML containing a `Gather` that posts to `/provider-webhooks/twilio/voice`.
- Fake providers remain the local default and are unchanged.

## Out Of Scope

- Non-Twilio vendor signature validation.
- Provider status/delivery receipt handling.
