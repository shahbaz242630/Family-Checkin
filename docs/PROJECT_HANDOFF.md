# Nearby Project Handoff

Last updated: 2026-04-26

## Current Product Direction

The project has pivoted from the original "Family Check-In" app to the BRD v2.1 product: **Nearby**, a cross-border family check-in platform.

Core product model:

- The **sender** uses the mobile app and pays.
- The **receiver** does not install an app.
- The backend orchestrates receiver consent, scheduled check-ins, channel cascades, escalation, billing, audit logs, and admin workflows.
- Receiver channels are WhatsApp, SMS, and short voice confirmation calls.
- Consent, opt-out, abuse reporting, auditability, and PII encryption are non-negotiable requirements.

Source of truth:

- `Business Requirements Document.txt`

## Repository Layout

The repo was restructured toward the BRD layout:

- `apps/mobile` - existing Expo/React Native mobile app
- `apps/backend` - new NestJS/Prisma backend foundation
- `packages/shared-types` - shared type package moved from old `shared`
- `docs` - project docs and handoff files

Root scripts:

- `npm run backend:test`
- `npm run backend:type-check`
- `npm run backend:build`
- `npm run backend:prisma:validate`
- `npm run start` - starts mobile app
- `npm run ios`
- `npm run android`

## Protected Auth Boundary

The mobile auth setup took significant effort and must not be casually rewritten.

Protected files whose contents were verified unchanged after the restructure:

- `apps/mobile/src/services/supabase.ts`
- `apps/mobile/src/services/auth.ts`
- `apps/mobile/src/contexts/AuthContext.tsx`
- `apps/mobile/src/components/auth/ProtectedRoute.tsx`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/app/auth/callback.tsx`
- `apps/mobile/src/app/auth/reset-password.tsx`
- `apps/mobile/app.json`

Important auth behavior to preserve:

- Supabase client/session setup
- SecureStore auth persistence
- OAuth state handling
- Deep-link callback and reset-password routing
- `familycheckin` URL scheme
- Existing auth screens unless explicitly approved

Before and after auth-sensitive work, compare these files against the original Git blobs or inspect diffs carefully.

## Supabase Status

Supabase project ref:

- `nrohtflgytywovwabvdo`

The public app schema was reset and rebuilt for the new BRD model. Supabase Auth users/config were not deleted.

Old public tables removed:

- `users`
- `loved_one_profiles`
- `relationships`
- `pairing_codes`
- `checkin_schedules`
- `checkins`
- `escalation_plans`
- `escalation_events`
- `contact_points`
- `subscriptions`
- `device_tokens`

New public tables created:

- `users`
- `receivers`
- `backup_contacts`
- `co_monitors`
- `check_ins`
- `escalation_events`
- `subscriptions`
- `audit_logs`
- `abuse_reports`
- `opt_out_cooldowns`
- `admin_users`
- `channel_templates`
- `idempotency_keys`

RLS is enabled on BRD user-facing tables:

- `users`
- `receivers`
- `backup_contacts`
- `check_ins`
- `escalation_events`
- `subscriptions`
- `co_monitors`
- `abuse_reports`
- `opt_out_cooldowns`
- `audit_logs`

Current policies are intentionally minimal:

- `users_read_own`
- `receivers_read_own`
- `receivers_modify_own`
- `receivers_read_co_monitor`
- `audit_logs_read_own`

Internal/backend-controlled tables currently do not have RLS:

- `admin_users`
- `channel_templates`
- `idempotency_keys`

Audit log immutability:

- `audit_logs_no_update`
- `audit_logs_no_delete`
- Verified in a rolled-back transaction: UPDATE and DELETE were blocked.

UUID defaults:

- All UUID primary-key tables use DB-side `gen_random_uuid()`.

Removed old trigger:

- `auth.users -> public.users` trigger `on_auth_user_created`

Reason: the old trigger inserted into the old `public.users` schema and would break the new encrypted users table. New user profile creation should happen through the NestJS backend, not a DB trigger.

Security note:

- Supabase access token and DB password were pasted in chat during setup. Rotate them after the foundation work settles.

## Backend Foundation

Backend stack now started in `apps/backend`:

- NestJS
- Prisma 7
- Vitest
- TypeScript strict mode
- Node/Postgres foundation

Key files:

- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/202604260001_initial_nearby_schema/migration.sql`
- `apps/backend/prisma/supabase_setup.sql`
- `apps/backend/prisma/reset_public_schema_for_nearby.sql`
- `apps/backend/prisma.config.ts`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/main.ts`
- `apps/backend/src/modules/audit/audit.module.ts`
- `apps/backend/src/modules/audit/audit.repository.ts`
- `apps/backend/src/modules/audit/audit.service.ts`
- `apps/backend/src/modules/audit/prisma-audit.repository.ts`
- `apps/backend/src/modules/auth/auth.controller.ts`
- `apps/backend/src/modules/auth/auth.module.ts`
- `apps/backend/src/modules/auth/supabase-auth.service.ts`
- `apps/backend/src/modules/channels/channel-provider.ts`
- `apps/backend/src/modules/channels/channel-providers.factory.ts`
- `apps/backend/src/modules/channels/channel-router.service.ts`
- `apps/backend/src/modules/channels/channels.module.ts`
- `apps/backend/src/modules/channels/fake-channel.provider.ts`
- `apps/backend/src/modules/channels/sms.provider.ts`
- `apps/backend/src/modules/channels/whatsapp.provider.ts`
- `apps/backend/src/modules/channels/voice.provider.ts`
- `apps/backend/src/modules/receivers/receivers.controller.ts`
- `apps/backend/src/modules/receivers/receivers.module.ts`
- `apps/backend/src/modules/receivers/receivers.repository.ts`
- `apps/backend/src/modules/receivers/receiver-consent.service.ts`
- `apps/backend/src/modules/receivers/receivers.service.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.ts`
- `apps/backend/src/shared/crypto/crypto.service.ts`
- `apps/backend/src/shared/config/app-config.service.ts`
- `apps/backend/src/shared/config/app-config.module.ts`
- `apps/backend/src/shared/phone/phone-normalizer.ts`
- `apps/backend/src/shared/prisma/prisma.service.ts`
- `apps/backend/src/modules/users/users.service.ts`
- `apps/backend/src/modules/users/prisma-users.repository.ts`
- `apps/backend/src/modules/users/users.repository.ts`
- `apps/backend/src/modules/users/users.module.ts`

Implemented backend behavior:

- `CryptoService`
  - AES-256-GCM encryption/decryption
  - deterministic SHA-256 lookup hashes
  - validates 32-byte master key
- `normalizePhone`
  - validates and formats phone numbers to E.164
- `UsersService`
  - accepts Supabase Auth identity data
  - normalizes email
  - normalizes phone
  - encrypts email/phone
  - hashes email/phone for lookup
  - upserts sender profile by `authProviderId`
- `AppConfigService`
  - validates required backend env vars at startup
  - validates `KMS_MASTER_KEY_BASE64` decodes to exactly 32 bytes
  - exposes `DATABASE_URL`, Supabase URL/keys, KMS key, and `PORT`
- `AuthController`
  - exposes `POST /auth/sync-user`
  - requires `Authorization: Bearer <supabase-access-token>`
  - verifies the token through Supabase Auth `/auth/v1/user`
  - calls `UsersService.upsertFromSupabaseIdentity`
  - returns only non-sensitive sender profile fields
- `SupabaseAuthService`
  - calls Supabase Auth with the backend anon key
  - maps Supabase user id/email/phone and metadata into sender identity
  - defaults missing metadata to `AE`, `en`, and `Asia/Dubai`
- `AuditService`
  - appends audit events through a repository only; no update/delete service paths
  - validates required `entityType`, `entityId`, and `action`
  - rejects metadata keys that look like raw PII (`email`, `phone`, `name`, `address`, `note`, `transcript`, `location`, `contact`)
  - rejects metadata string values that look like email addresses or phone numbers
  - allows safe operational metadata such as statuses, channels, and ids
- `PrismaAuditRepository`
  - writes audit events to Prisma `auditLog.create`
  - relies on existing database triggers to keep `audit_logs` append-only
- `ReceiversService`
  - creates receiver records for an authenticated sender
  - trims receiver name and normalizes receiver phone to E.164
  - encrypts receiver name, phone, and optional personal note before persistence
  - stores deterministic receiver phone hash for lookup/deduplication
  - forces `consentStatus` to `PENDING` at creation
  - writes a `receiver.created` audit event through `AuditService`
  - keeps audit metadata free of raw receiver PII
- `PrismaReceiversRepository`
  - writes receiver records to Prisma `receiver.create`
  - maps nullable DB fields back to optional service fields
- `ReceiversController`
  - exposes `POST /receivers`
  - requires `Authorization: Bearer <supabase-access-token>`
  - verifies the Supabase access token through `SupabaseAuthService`
  - upserts/resolves the sender profile through `UsersService`
  - calls `ReceiversService.createForSender`
  - now calls `ReceiverConsentService.requestConsent` immediately after receiver creation
  - forwards `User-Agent` and first `X-Forwarded-For` IP into audit context
  - returns only non-sensitive receiver fields plus `consentRequestStatus: "requested"`; no encrypted payloads, hashes, provider ids, or raw PII
- `ReceiverConsentService`
  - sends initial consent requests using `ChannelRouterService`
  - uses `sendMessage` for WhatsApp/SMS primary channels
  - uses `makeVoiceCall` for voice-only consent requests
  - decrypts receiver phone/name only at the send boundary
  - persists encrypted consent request transcript on the receiver
  - sets `consentRequestedAt` through `ReceiversRepository.markConsentRequested`
  - writes `receiver.consent_requested` audit events with safe metadata only
  - blocks duplicate consent requests if `consentRequestedAt` is already set
- `ChannelProvider` contract
  - vendor-neutral interface for WhatsApp, SMS, and Voice providers
  - supports templated messages, short voice calls, and phone-number availability checks
  - keeps cascade/consent business logic independent from Twilio, Meta, 360dialog, or other vendors
- `ChannelRouterService`
  - routes `sendMessage`, `makeVoiceCall`, and `isAvailableForNumber` calls by Prisma `Channel`
  - rejects unregistered channels explicitly
- `FakeChannelProvider`
  - deterministic test provider that records outbound messages and voice calls
  - supports availability checks for channel auto-detection tests
- `createChannelProviders`
  - reads `AppConfigService.channelProviderMode`
  - returns fake WhatsApp/SMS/Voice providers when `CHANNEL_PROVIDER_MODE=fake`
  - returns configured adapter classes when `CHANNEL_PROVIDER_MODE=configured`
- `SmsProvider`, `WhatsappProvider`, `VoiceProvider`
  - adapter stubs are present behind the `ChannelProvider` contract
  - they fail clearly when credentials are missing
  - actual vendor API calls are intentionally not implemented until a vendor is selected and credentials are available

Backend env/provider settings:

- `CHANNEL_PROVIDER_MODE`
  - `fake` for local full-journey testing without credentials
  - `configured` for real provider adapters
- `SMS_PROVIDER_API_KEY`
- `SMS_PROVIDER_FROM_NUMBER`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `VOICE_PROVIDER_API_KEY`
- `VOICE_PROVIDER_FROM_NUMBER`
- These are documented in `apps/backend/.env.example`.
- `.gitignore` now explicitly ignores common provider credential/secret dump file patterns in addition to existing `.env` protection.

Tests:

- `apps/backend/src/shared/crypto/crypto.service.spec.ts`
- `apps/backend/src/shared/config/app-config.service.spec.ts`
- `apps/backend/src/shared/phone/phone-normalizer.spec.ts`
- `apps/backend/src/modules/audit/audit.service.spec.ts`
- `apps/backend/src/modules/audit/prisma-audit.repository.spec.ts`
- `apps/backend/src/modules/auth/auth.controller.spec.ts`
- `apps/backend/src/modules/auth/supabase-auth.service.spec.ts`
- `apps/backend/src/modules/channels/channel-providers.factory.spec.ts`
- `apps/backend/src/modules/channels/channel-router.service.spec.ts`
- `apps/backend/src/modules/channels/configured-channel-providers.spec.ts`
- `apps/backend/src/modules/channels/fake-channel.provider.spec.ts`
- `apps/backend/src/modules/receivers/receiver-consent.service.spec.ts`
- `apps/backend/src/modules/receivers/receivers.controller.spec.ts`
- `apps/backend/src/modules/receivers/receivers.service.spec.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.spec.ts`
- `apps/backend/src/modules/users/users.service.spec.ts`

Latest backend verification passed:

- `npm.cmd --prefix apps/backend test` - 16 files, 36 tests passed on 2026-04-26
- `npm.cmd --prefix apps/backend run type-check` - passed on 2026-04-26
- `npm.cmd --prefix apps/backend run build` - passed on 2026-04-26
- `DATABASE_URL='postgresql://user:password@localhost:5432/nearby' npm.cmd --prefix apps/backend run prisma:validate`

Generated build output:

- `apps/backend/dist` is recreated by `npm.cmd --prefix apps/backend run build`.
- It was deleted after verification to keep the working tree clean.

## Git / Working Tree Notes

Pre-existing user/local changes before restructure:

- `.claude/settings.local.json`
- `Business Requirements Document.txt`

The folder move appears in Git as old `frontend`, `backend`, and `shared` files deleted, with new `apps/` and `packages/` files untracked until staged.

Do not revert unrelated user changes.

## Cleanup Already Done

Deleted obsolete/generated backend artifacts:

- `apps/backend/supabase`
- `apps/backend/apps`
- `apps/backend/dist`

Removed old Supabase CLI backend scripts from `apps/backend/package.json`.

Updated `.gitignore` to avoid leaking secrets:

- root and nested `.env` / `.env.*`
- `apps/*/.env*`
- `packages/*/.env*`
- Supabase temp/env files
- native signing keys
- Firebase/Google service config
- `secrets/`
- `private/`

`.env.example` files are intentionally allowed.

Known local secret file:

- `apps/mobile/.env` exists locally and is ignored.

## Known Issues / Risks

Mobile type-check is not clean from pre-existing issues:

- stale Supabase types
- `resetPassword` naming mismatch
- missing `ScreenHeader`
- missing `warningLight`
- old Expo FileSystem API usage
- old onboarding DB insert typing

These are not from the backend foundation and should be addressed when the mobile app is adapted to the new BRD workflow.

npm audit currently reports vulnerabilities. Do not run broad `npm audit fix --force` casually; handle dependency audit deliberately after the foundation stabilizes.

Prisma 7 note:

- `DATABASE_URL` lives in `apps/backend/prisma.config.ts`, not inside `schema.prisma`.
- Use a temporary/dummy `DATABASE_URL` for local schema validation when not connecting to a real DB.

## Recommended Next Tasks

1. **Select real channel vendors and finish adapters**
   - SMS and Voice can be implemented against Twilio/Vonage/etc. once selected.
   - WhatsApp can be implemented against Meta Cloud API, Twilio, 360dialog, etc. once selected.
   - Keep provider credentials in backend env only.
   - Keep outbound content templated; do not send raw user-supplied text directly.

2. **Mobile integration planning**
   - Keep auth screens working.
   - After mobile login, call backend `POST /auth/sync-user` with the Supabase access token.
   - Add receiver setup screens that call backend `POST /receivers`.
   - With `CHANNEL_PROVIDER_MODE=fake`, local testing can cover receiver creation plus consent request without real provider credentials.
   - Replace old onboarding/loved-one flow with BRD sender -> receiver setup.
   - Do not patch old DB calls; delete stale flows when replacing.

3. **Consent response ingestion**
   - Add inbound webhook handlers for WhatsApp/SMS/Voice provider callbacks.
   - Parse YES/NO/STOP/REPORT safely.
   - Update receiver consent status and encrypted transcript.
   - Write append-only audit events.

4. **Secrets rotation**
   - Rotate the Supabase access token and DB password that were pasted in chat after foundation work settles.

## First Command In A New Session

Read this file first:

```powershell
Get-Content -LiteralPath docs\PROJECT_HANDOFF.md
```

Then check current state:

```powershell
git status --short --branch
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
```
