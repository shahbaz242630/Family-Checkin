# Channels and providers — feature handoff

Status: Built · Last verified: 2026-09-06 (acceptance run)
BRD: FR-CHN-01, FR-CHN-02, FR-CHN-03, FR-CHN-03a, FR-CHN-03b, FR-CHN-03c-1, FR-LNG-02, BRD-6.6, BRD-6.11, BRD-7 · Open backlog: CB-010 (remaining slices), CB-016, CB-019, CB-020, CB-021, CB-022, CB-046, CB-047
Per area: fake-mode send, English catalog rendering, fake-route gating, signed voice-status webhook — 2026-09-06 (acceptance run); Twilio request shapes, WhatsApp Content SIDs, TwiML Gather, `channel_templates` override — 2026-09-06 (specs). No live Twilio or Meta credentials exist; nothing has been sent to a real phone.

## What it does

- Every outbound message and call goes through one vendor-neutral `ChannelProvider` (`sendMessage`, `makeVoiceCall`, `isAvailableForNumber`) per `Channel` (`WHATSAPP`, `SMS`, `VOICE`), so cascade, consent and escalation logic never names a vendor.
- `CHANNEL_PROVIDER_MODE` decides the implementations at boot: `fake` yields three `FakeChannelProvider`s that record sends in memory; `configured` yields the Twilio-backed `WhatsappProvider`, `SmsProvider` and `VoiceProvider`.
- `MessageCatalogService` turns a template key + language + variables into the text a person reads: an active `channel_templates` row wins, then in-code English copy, then English with `fallback: true`; a missing or blank required variable throws.
- `ChannelRouterService` dispatches by channel and resolves a reachable plan for a phone number (`PRIMARY_AVAILABLE` / `FALLBACK_SELECTED` / `MANUAL_REQUIRED`); the tech profile decides the cascade shape upstream in `CheckInsService`.
- Signed Twilio webhooks bring inbound replies (SMS/WhatsApp text and quick-reply buttons, voice DTMF/speech) and call outcomes (status, AMD) back into `ReceiverReplyService` and `CheckInsService`.
- In fake mode only, `POST /receiver-replies/fake` drives the real reply pipeline with no provider involved, and `GET /receiver-replies/fake/outbound` lists what the fake providers sent; every fake send also prints a `[fake-provider]` line in the terminal.

## Where it lives

| Layer   | Paths                                                                                                                                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend | `apps/backend/src/modules/channels/` (`channel-provider.ts`, `channel-providers.factory.ts`, `channel-router.service.ts`, `fake-channel.provider.ts`, `fake-outbound-recorder.ts`, `sms.provider.ts`, `whatsapp.provider.ts`, `voice.provider.ts`, `twilio-http-client.ts`, `twilio-rendering.ts`, `message-catalog.service.ts`, `message-catalog.templates.ts`, `channel-template.repository.ts`, `prisma-channel-template.repository.ts`) |
| Backend | `apps/backend/src/modules/provider-webhooks/` (controller, module, `provider-webhook-events.repository.ts`, `prisma-provider-webhook-events.repository.ts`); `apps/backend/src/modules/receivers/receiver-replies.controller.ts` + `receiver-replies.module.ts`; `apps/backend/src/shared/config/app-config.service.ts`; `apps/backend/src/shared/auth/bearer-secret.ts` |
| Callers | `check-ins.service.ts` (`checkInMessageVariables`, `buildCascadeAttempts`, `voiceCallOptions`), `receiver-consent.service.ts`, `receivers.service.ts` (`lifecycleMessageVariables`), `escalations.service.ts` (`backupAlertContext`), `account/step-up.service.ts`                                  |
| Mobile  | none — this feature has no mobile surface                                                                                                                                                                                                                                                         |
| Data    | `channel_templates` (`schema.prisma:463`, 0 rows: no seed migration yet), `provider_webhook_events` (`schema.prisma:337`), `voice_caller_id_pool` (`schema.prisma:213`, never written — CB-022)                                                                                                    |
| Tests   | `channel-providers.factory.spec.ts`, `configured-channel-providers.spec.ts`, `fake-channel.provider.spec.ts`, `fake-outbound-recorder.spec.ts`, `channel-router.service.spec.ts`, `message-catalog.service.spec.ts`, `prisma-channel-template.repository.spec.ts`, `provider-webhooks.controller.spec.ts`, `prisma-provider-webhook-events.repository.spec.ts`, `receiver-replies.controller.spec.ts`, `app.module.spec.ts`, `app-config.service.spec.ts` |

Env var names per mode (names only; all are read in `app-config.service.ts`, validated with zod at boot):

| Mode                            | Required                                                                                                                                    | Also read                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `CHANNEL_PROVIDER_MODE=fake`    | nothing beyond `CHANNEL_PROVIDER_MODE` (plus `OPERATIONS_CRON_SECRET` for the fake reply route)                                              | —                                                             |
| `CHANNEL_PROVIDER_MODE=configured` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM_NUMBER`, `TWILIO_WHATSAPP_FROM_NUMBER`, `TWILIO_WHATSAPP_CONTENT_SIDS`, `TWILIO_VOICE_FROM_NUMBER`, `PUBLIC_API_BASE_URL`, `VOICE_AUDIO_BASE_URL` | `CHANNEL_WEBHOOK_SECRET` (Meta/generic webhook header)        |

Every `TWILIO_*` var is `optional()` in the schema, so a `configured` boot with none of them set succeeds and each provider throws `ChannelProviderConfigurationError` at first use. `SMS_PROVIDER_*`, `VOICE_PROVIDER_*`, `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are parsed but dead (CB-019, CB-021, CB-022).

## Routes and contracts

- `POST /provider-webhooks/twilio/messaging` — Twilio. `X-Twilio-Signature` (HMAC-SHA1 over `${PUBLIC_API_BASE_URL}` + path + sorted key/value pairs, compared timing-safe). Body `From`, `Body`, `ButtonText`, `ButtonPayload`, `MessageSid`; `ButtonPayload` wins, then `ButtonText`, then `Body`. `whatsapp:` prefix on `From` selects `WHATSAPP`. Replays of a stored `MessageSid` short-circuit to `{ ok: true, processed: 0 }`.
- `POST /provider-webhooks/twilio/voice` — the `<Gather>` action URL. Signed. `Digits` first, then `SpeechResult`; `To` is treated as the receiver's number; `CallSid` becomes the provider message id.
- `POST /provider-webhooks/twilio/voice/status` — `StatusCallback`. Signed. Stores a `voice_status` event and calls `CheckInsService.recordVoiceProviderFailure({ providerMessageId, providerStatus })`.
- `POST /provider-webhooks/twilio/voice/amd` — `AsyncAmdStatusCallback`. Signed. Stores a `voice_amd` event and calls `recordVoiceProviderFailure({ providerMessageId, answeredBy })`.
- `POST /provider-webhooks/whatsapp` and `POST /provider-webhooks/sms` — header `x-nearby-webhook-secret` = `CHANNEL_WEBHOOK_SECRET`, timing-safe. Meta-shaped and generic/Twilio-style bodies respectively; neither is wired to a live provider (CB-019, CB-021).
- All webhook routes are `@SkipThrottle()` and answer `{ ok: true, processed: number }` only — never phones, bodies or payloads.
- `POST /receiver-replies/fake` — registered **only** when `channelProviderModeFromEnv() === 'fake'` (`ReceiverRepliesModule.register`); 404 in configured mode. Header `Authorization: Bearer <OPERATIONS_CRON_SECRET>` via `assertBearerSecret`, else 401. Body `{ fromPhone, channel, body, providerMessageId? }`. Returns `{ ok: true, receiverId, action, consentStatus?, checkInId?, checkInStatus?, backupContactId? }`.
- `GET /receiver-replies/fake/outbound?limit=N` — same registration rule and the same cron-secret bearer. Returns `{ ok: true, count, sends[] }`, newest first; `limit` is 1–200 (default 50, 400 otherwise). A record is `kind: "message"` (`to`, `providerMessageId`, `templateKey`, `language`, `fallback`, rendered `body`) or `kind: "voice_call"` (`to`, `providerCallId`, `scriptKey`, `language`, `variables`, `fromNumber?`). Backed by `FakeOutboundRecorder` (200-record ring buffer, one per process), which also prints each record through the Nest logger as `[fake-provider] SMS message to ***3401 (checkin_daily, en) fake-SMS-message-1: "…"`. Configured providers never write to it.

Outbound Twilio shapes (asserted by `configured-channel-providers.spec.ts`): SMS `POST .../Accounts/{Sid}/Messages.json` with `To`/`From`/`Body` (body rendered by the catalog). WhatsApp the same URL with `whatsapp:`-prefixed `To`/`From`, `ContentSid` and `ContentVariables` (JSON of the variables) — the SID comes from `TWILIO_WHATSAPP_CONTENT_SIDS` keyed `templateKey:language` then `templateKey`, and a miss throws before any HTTP call. Voice `POST .../Accounts/{Sid}/Calls.json` with inline `Twiml`, `MachineDetection=Enable`, `AsyncAmd=true`, `AsyncAmdStatusCallback`, `AsyncAmdStatusCallbackMethod=POST`, `StatusCallback`, `StatusCallbackEvent='initiated ringing answered completed'`, `StatusCallbackMethod=POST`. The TwiML is two identical `<Gather input="dtmf" numDigits="1" timeout="10" method="POST" action=".../provider-webhooks/twilio/voice">` blocks each wrapping `<Play>${VOICE_AUDIO_BASE_URL}/{en|ar|es|hi|ur}/{scriptKey}.wav</Play>`, then `<Hangup/>`.

Message template keys and the variables each requires (`{{var}}` required, `{{#var}}…{{/var}}` optional section):

| Template key                            | Required                             | Optional             | Sent by                          |
| --------------------------------------- | ------------------------------------ | -------------------- | -------------------------------- |
| `consent_request`                       | `receiverName`, `senderDisplayName`  | `personalNote`       | `receiver-consent.service.ts`    |
| `checkin_daily`                         | `receiverName`, `senderDisplayName`  | `personalNote`       | `check-ins.service.ts`           |
| `checkin_retry`                         | `receiverName`, `senderDisplayName`  | `personalNote`       | no caller yet (CB-010 remainder) |
| `receiver_checkins_paused`              | `receiverName`, `senderDisplayName`  | —                    | `receivers.service.ts`           |
| `receiver_checkins_ended`               | `receiverName`, `senderDisplayName`  | —                    | `receivers.service.ts`           |
| `account_step_up_otp`                   | `code`, `validityMinutes`            | —                    | `account/step-up.service.ts`     |
| `backup_contact_missed_checkin_alert`   | `contactName`, `receiverName`, `senderDisplayName` | `channelsTried`, `locationInstructions` | `escalations.service.ts` |
| `backup_contact_help_alert`             | `contactName`, `receiverName`, `senderDisplayName` | `channelsTried`, `locationInstructions` | `escalations.service.ts` |
| `backup_contact_sender_requested_alert` | `contactName`, `receiverName`, `senderDisplayName` | `channelsTried`, `locationInstructions` | `escalations.service.ts` |

Voice uses `scriptKey`, not the catalog: `checkin_daily_voice`, `consent_request_voice`, `receiver_checkins_paused_voice`, `receiver_checkins_ended_voice`, `sender_escalation_siren_voice`. Only English copy exists in `IN_CODE_MESSAGE_TEMPLATES`; every other language falls back to English with `renderFallback: true` in the audit metadata.

## How to exercise it locally (fake mode)

- Set `CHANNEL_PROVIDER_MODE=fake` and `OPERATIONS_CRON_SECRET` in `apps/backend/.env` per `docs/EMULATOR_RUNBOOK.md` §3, then start the backend. No `TWILIO_*` value is needed.
- Drive an inbound reply: `POST /receiver-replies/fake` with `Authorization: Bearer <OPERATIONS_CRON_SECRET>` and `{"fromPhone":"+44...","channel":"SMS","body":"YES"}`. Without the bearer it is 401; with `CHANNEL_PROVIDER_MODE=configured` the route is 404.
- Drive an outbound send: `POST /operations/check-ins/run` (cron-secret bearer). The `check_in.sent` audit row carries `renderedLanguage` and `renderFallback`; the rendered body prints in the backend terminal as a `[fake-provider]` line and is returned by `GET /receiver-replies/fake/outbound` (cron-secret bearer).
- Exercise a Twilio route locally by setting `TWILIO_AUTH_TOKEN` and `PUBLIC_API_BASE_URL` to test values and computing the HMAC-SHA1 signature the same way `computeTwilioSignature` does; an unsigned request is 401.
- To see a `channel_templates` override, insert an active row for `(templateKey, language, channel)` — it wins over the in-code copy on the next send.

## Invariants — do not break

- Business logic talks to `ChannelRouterService` / `ChannelProvider` only. No module outside `modules/channels/` may import a Twilio symbol or construct a provider.
- `createChannelProviders` is the single switch on `config.channelProviderMode`. Both branches must return one provider per `Channel`, or `ChannelRouterService.providerFor` throws at send time.
- The fake reply controller must stay registered from `channelProviderModeFromEnv()` at module-build time (Nest cannot remove a controller after boot) and must keep the cron-secret bearer on both routes. Both halves are CB-001; `app.module.spec.ts` asserts both routes are absent in configured mode and that the providers, the recorder and the controller share one `FakeOutboundRecorder` instance.
- Only `FakeChannelProvider` may write to `FakeOutboundRecorder`. It holds phone numbers and message bodies in memory by design; a configured provider writing to it would copy real PII into a listable buffer.
- Webhook secret and Twilio signature comparisons stay timing-safe and fail closed on a missing header, missing token or missing `PUBLIC_API_BASE_URL`. The signed URL must be exactly `${PUBLIC_API_BASE_URL}${path}`, so changing a route path or the base URL breaks every signature.
- Twilio inbound is stored **after** successful processing, keyed `(provider, eventType, providerEventId)`, so a transient failure leaves nothing behind and Twilio's retry is processed rather than mistaken for a replay (CB-015).
- `provider_webhook_events.payload` for inbound messaging stays PII-free — `MessageSid`, `channel`, `bodyLength`, `hasButtonPayload`. Never the phone or the body.
- Rendering fails closed: a missing or blank required variable throws `MissingMessageVariableError`, and a body can never leave with `{{…}}` still in it (`MalformedMessageTemplateError`). Variable values are inserted verbatim and never re-scanned, so a name containing braces cannot inject a placeholder.
- `ChannelSendResult.rendering` is present only when the provider rendered the body (SMS, fake) and absent for provider-side templates (WhatsApp Content SIDs); `renderingAuditMetadata` must keep tolerating `undefined`.
- Phones are decrypted only at the moment of the provider call, never earlier and never into an audit row.
- `WhatsappProvider.isAvailableForNumber` asserts configuration and therefore throws when credentials are absent; `resolveReachablePlan` catches that and returns `MANUAL_REQUIRED` rather than silently dropping the channel.
- `VoiceProvider` honours `options.fromNumber` (the sticky caller-ID pool) and falls back to `TWILIO_VOICE_FROM_NUMBER`.

## Known gaps

- CB-010 — English copy only; per-language seed migration, a real sender display name, and `checkin_retry` on later attempts are still outstanding.
- CB-016 — no `StatusCallback` on SMS/WhatsApp and no `/twilio/messaging/status` route, so an undelivered message looks "sent" for the rest of the cascade window; the `provider_webhook_events` dedupe index is non-unique.
- CB-019 — Twilio error `code`/`message` are discarded by `twilio-http-client.ts`; dead `SMS_PROVIDER_*` config and the internal `/provider-webhooks/sms` route should go; the inbound URL is undocumented.
- CB-020 — `char(5)` language padding breaks Content-SID lookup (`"en   "`); the 8 templates × languages are unapproved; `TWILIO_WHATSAPP_CONTENT_SIDS` is parsed lazily instead of at boot.
- CB-021 — the Meta WhatsApp Cloud API path is half-built: env parsed, no client, no `hub.challenge` GET, custom header instead of `X-Hub-Signature-256`.
- CB-022 — `/twilio/voice` answers JSON where Twilio expects `text/xml` (Twilio 12100); digit `9`/"stop" unmapped; no hosted audio at `VOICE_AUDIO_BASE_URL`; only 5 language folders in `languagePath`; `voice_caller_id_pool` has no writer; dead `VOICE_PROVIDER_*` config.
- CB-046 — no timeout on the Twilio fetch, so a stalled socket can hang an attempt.
- CB-047 — no logging anywhere; Twilio error codes never reach `attempt.failureReason`.

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` "Backend Foundation" (lines 184–700: `ChannelProvider` contract and `createChannelProviders` at 338–353, env names at 379–386, voice research and the Twilio credential-readiness / AMD / caller-ID / status-persistence slices at 392–570), §29 (2234–2332, provider webhook adapters), §34 slice 2 (3383–3399, WhatsApp Content Templates), §0a (793–804, sprint 1).
- Acceptance: `docs/audits/2026-09-06/sprint1-acceptance.md` — S1 (fake route gating, configured boot 404), S3 (catalog rendering and fail-closed), S4 (signed messaging webhook, replay, never 500), S8 (signed voice status callback), defect D1, and the "configured" row of the boot table.
- PRs: #17 (CB-015 inbound idempotency by `MessageSid`), #18 (CB-001 fake route gated to fake mode plus cron-secret bearer), #19 (CB-010 English catalog; `renderTwilioMessage` deleted).
- Related handoffs: `docs/handoffs/escalations-and-notifications.md` (backup alert fan-out that consumes these templates), `docs/handoffs/backup-contacts.md`.
