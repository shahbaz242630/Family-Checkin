# Provider Webhook Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add protected WhatsApp and SMS inbound webhook adapter endpoints that feed the existing normalized receiver reply service.

**Architecture:** Add a `ProviderWebhooksModule` with a controller that parses provider-shaped payloads at the edge. The controller authenticates callbacks with `CHANNEL_WEBHOOK_SECRET`, normalizes valid inbound replies, and delegates all consent/check-in/backup-contact behavior to `ReceiverReplyService`.

**Tech Stack:** NestJS, Prisma enums, Vitest, TypeScript.

---

### Task 1: Webhook Controller Contract

**Files:**
- Create: `apps/backend/src/modules/provider-webhooks/provider-webhooks.controller.spec.ts`
- Create: `apps/backend/src/modules/provider-webhooks/provider-webhooks.controller.ts`

- [x] Write failing tests for WhatsApp text payload normalization, WhatsApp non-text ignoring, SMS payload normalization, and rejected bad webhook secrets.
- [x] Run `npm.cmd --prefix apps/backend test -- provider-webhooks.controller.spec.ts` and verify RED because the controller does not exist.
- [x] Implement the controller with `POST /provider-webhooks/whatsapp` and `POST /provider-webhooks/sms`.
- [x] Return only `{ ok: true, processed }`.

### Task 2: Config And Module Wiring

**Files:**
- Modify: `apps/backend/src/shared/config/app-config.service.ts`
- Modify: `apps/backend/src/shared/config/app-config.service.spec.ts`
- Modify: `apps/backend/.env.example`
- Create: `apps/backend/src/modules/provider-webhooks/provider-webhooks.module.ts`
- Modify: `apps/backend/src/app.module.ts`

- [x] Add optional `CHANNEL_WEBHOOK_SECRET` parsing and getter.
- [x] Document `CHANNEL_WEBHOOK_SECRET` in `.env.example`.
- [x] Import `ReceiversModule` so the webhook controller can inject `ReceiverReplyService`.
- [x] Register `ProviderWebhooksModule` in `AppModule`.

### Task 3: Verification And Handoff

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

- [x] Run focused webhook/config tests.
- [x] Run backend tests.
- [x] Run backend type-check.
- [x] Run backend build.
- [x] Validate Prisma schema with a dummy `DATABASE_URL`.
- [x] Update handoff with endpoints, auth, PII boundary, and verification.

### Task 4: Twilio Webhook Hardening

**Files:**
- Modify: `apps/backend/src/modules/provider-webhooks/provider-webhooks.controller.spec.ts`
- Modify: `apps/backend/src/modules/provider-webhooks/provider-webhooks.controller.ts`
- Modify: `apps/backend/src/shared/config/app-config.service.ts`
- Modify: `apps/backend/src/shared/config/app-config.service.spec.ts`
- Modify: `apps/backend/.env.example`

- [x] Write failing tests for Twilio SMS, Twilio WhatsApp, Twilio voice, and invalid Twilio signatures.
- [x] Run `npm.cmd --prefix apps/backend test -- provider-webhooks.controller.spec.ts` and verify RED because Twilio endpoints do not exist.
- [x] Add `POST /provider-webhooks/twilio/messaging`.
- [x] Add `POST /provider-webhooks/twilio/voice`.
- [x] Validate `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN`, `PUBLIC_API_BASE_URL`, endpoint path, and submitted params.
- [x] Normalize Twilio WhatsApp `From=whatsapp:+E164` to `Channel.WHATSAPP`.
- [x] Normalize Twilio SMS `From=+E164` to `Channel.SMS`.
- [x] Normalize Twilio voice `Digits` or `SpeechResult` to `Channel.VOICE`.
