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

## Out Of Scope

- Vendor-specific signature validation.
- WhatsApp GET verification challenge.
- Outbound provider API implementation.
- Voice webhook handling.
- Provider status/delivery receipt handling.
