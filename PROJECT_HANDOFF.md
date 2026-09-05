# Nearby Project Handoff

Last updated: 2026-05-15

## Current Product Direction

The project has pivoted from the original "Family Check-In" app to the BRD v2.1 product: **Nearby**, a cross-border family check-in platform.

Core product model:

- The **sender** uses the mobile app and pays.
- The **receiver** does not install an app.
- The backend orchestrates receiver consent, scheduled check-ins, channel cascades, escalation, billing, audit logs, and admin workflows.
- Receiver channels are WhatsApp, SMS, and short voice confirmation calls.
- Twilio is the selected integration provider for WhatsApp, SMS, and voice.
- Consent, opt-out, abuse reporting, auditability, and PII encryption are non-negotiable requirements.

Source of truth:

- `Business Requirements Document.txt`
- `PROJECT_HANDOFF.md`
- `README.md` has been refreshed for the Nearby direction as of 2026-04-27. It no longer describes the old Family Check-In scope.
- `docs/PROJECT_HANDOFF.md` is intentionally only a redirect stub. Do not use it as the working handoff.

## Repository Layout

The repo was restructured toward the BRD layout:

- `apps/mobile` - existing Expo/React Native mobile app
- `apps/backend` - new NestJS/Prisma backend foundation
- `packages/shared-types` - shared type package moved from old `shared`
- `docs` - project docs and implementation plans/specs

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

Protected files whose behavior must be preserved:

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
- AsyncStorage Supabase session persistence on native
- SecureStore OAuth state persistence on native
- Browser `localStorage` auth persistence on web smoke tests
- OAuth state handling
- Deep-link callback and reset-password routing
- `familycheckin` URL scheme
- Existing auth screens unless explicitly approved

Auth-sensitive note from 2026-04-26:

- `apps/mobile/src/services/supabase.ts` was minimally updated so the storage adapter uses Expo SecureStore on native and browser `localStorage` on web.
- This fixed Expo web auth smoke testing, where `expo-secure-store` threw `getValueWithKeyAsync is not a function`.
- Native Supabase Auth flow, deep-link handling, OAuth state validation, and reset-password logic were not rewritten.

Auth-sensitive note from 2026-04-29:

- Android React Native can expose `window`, so the previous runtime check misclassified native as web and routed Supabase session persistence to unavailable `localStorage`.
- Supabase session persistence now uses AsyncStorage on native and browser `localStorage` only when `Platform.OS === 'web'`.
- OAuth state remains in SecureStore on native.
- Covered by `apps/mobile/src/services/auth-storage.test.ts`.

Before and after auth-sensitive work, inspect diffs carefully.

## Supabase Status

Supabase project ref:

- `<project-ref, see apps/backend/.env>`

Use this project ref when running Supabase CLI commands that require `--project-ref` or when linking the local workspace to the hosted project.

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
- `check_ins_read_own`
- `check_ins_read_co_monitor`
- `audit_logs_read_own`

Internal/backend-controlled tables currently do not have RLS:

- `admin_users`
- `channel_templates`
- `idempotency_keys`

Audit log immutability:

- `audit_logs_no_update`
- `audit_logs_no_delete`
- Verified in a rolled-back transaction: UPDATE and DELETE were blocked.

Check-in RLS update from 2026-04-27:

- Added `apps/backend/prisma/20260427_check_ins_read_rls.sql` as a standalone hosted-project patch.
- Updated `apps/backend/prisma/supabase_setup.sql` so fresh rebuilds include the same policies.
- Applied the patch to Supabase project `<project-ref, see apps/backend/.env>` using the backend `DATABASE_URL`.
- Verified remote `pg_policies` contains:
  - `check_ins_read_own` (`SELECT`)
  - `check_ins_read_co_monitor` (`SELECT`)
- These policies allow sender-owned check-ins and accepted co-monitor check-ins to be read through user-scoped Supabase access. Backend writes remain service-role controlled; no user INSERT/UPDATE/DELETE policies were added for `check_ins`.

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
- Prisma Postgres adapter (`@prisma/adapter-pg`)
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
- `apps/backend/src/modules/check-ins/check-ins.module.ts`
- `apps/backend/src/modules/check-ins/check-ins.repository.ts`
- `apps/backend/src/modules/check-ins/check-ins.service.ts`
- `apps/backend/src/modules/check-ins/check-ins.tokens.ts`
- `apps/backend/src/modules/check-ins/prisma-check-ins.repository.ts`
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
- `apps/backend/src/modules/receivers/receiver-replies.controller.ts`
- `apps/backend/src/modules/receivers/receiver-reply.service.ts`
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
- `apps/mobile/src/services/backendApi.ts`
- `apps/mobile/src/app/(auth)/onboarding.tsx`
- `apps/mobile/src/hooks/useProfile.ts`
- `apps/mobile/src/components/common/ScreenHeader.tsx`

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
  - uses `user_metadata.phone` as a fallback for email/password users where Supabase Auth `phone` is empty
  - defaults missing metadata to `AE`, `en`, and `Asia/Dubai`
- Nest runtime dependency injection note from 2026-04-27:
  - `tsx watch` did not reliably provide constructor metadata for all controllers/repositories/services.
  - Added explicit `@Inject(...)` annotations on runtime-critical constructor dependencies for auth, receiver, check-in, and Prisma repository paths.
  - This fixed local HTTP sync and receiver creation paths that previously failed with undefined injected services.
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
- `ReceiverReplyService`
  - handles inbound receiver replies from fake/local provider callbacks
  - identifies receivers by normalized phone hash; raw phone is not stored in audit metadata
  - for receivers with pending consent, supports `YES` / `Y` / `1` / `OK` as consent granted
  - for receivers with pending consent, supports `NO` / `N` / `2` as consent declined
  - for receivers with granted consent and an open check-in, maps `1`, `OK`, `YES`, `I'M FINE`, `IM FINE`, and `I AM FINE` to `RESPONDED_OK`
  - for receivers with granted consent and an open check-in, maps `2`, `HELP`, and `NEED HELP` to `RESPONDED_HELP`
  - links check-in replies to the latest open `PENDING` or `SENT` check-in for that receiver
  - stores encrypted check-in response transcript and sets `respondedAt`, `responseDetectedAs`, and final check-in status
  - supports `STOP` as consent revoked
  - creates/updates a 7-day opt-out cooldown for `STOP`
  - supports `REPORT` by creating an encrypted abuse report and pausing the receiver pending review
  - encrypts inbound consent transcript details before storing them on the receiver
  - writes append-only audit events for `receiver.consent_granted`, `receiver.consent_declined`, `receiver.consent_revoked`, `receiver.abuse_reported`, `check_in.responded_ok`, and `check_in.responded_help`
  - currently rejects unsupported/ambiguous replies until parsing policy is expanded
- `ReceiverRepliesController`
  - exposes `POST /receiver-replies/fake`
  - intended for local/provider-free testing before real WhatsApp/SMS/Voice webhook adapters are implemented
  - accepts `fromPhone`, `channel`, `body`, and optional `providerMessageId`
  - returns `{ ok, receiverId, action, consentStatus }`
- `ChannelProvider` contract
  - vendor-neutral interface for WhatsApp, SMS, and Voice providers
  - supports templated messages, short voice calls, and phone-number availability checks
  - keeps cascade/consent business logic independent from Twilio-specific code so future provider swaps remain possible
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
  - configured adapters use Twilio for SMS, WhatsApp, and voice
  - they fail clearly when credentials are missing
- `CheckInsService`
  - finds receivers due for scheduled check-ins through `CheckInsRepository`
  - defensively skips candidates unless `consentStatus = GRANTED`, not deleted, and not currently paused
  - creates a `PENDING` check-in row before sending
  - sends the first check-in through `ChannelRouterService` using the receiver's primary channel
  - uses `checkin_daily` for WhatsApp/SMS and `checkin_daily_voice` for voice-only check-ins
  - decrypts receiver phone only at the send boundary
  - marks sent check-ins as `SENT` with channel and sent timestamp
  - writes safe system audit events for `check_in.created` and `check_in.sent`
- `PrismaCheckInsRepository`
  - finds daily receivers eligible for check-in where consent is granted, receiver is not deleted, receiver is not paused, and the receiver-local schedule window is due
  - evaluates schedule windows in the receiver's timezone, not UTC
  - excludes receivers that already have a check-in scheduled on the current UTC day to avoid repeated sends when the worker runs during the same window
  - creates `check_ins` rows and marks them sent through Prisma
  - finds the latest open check-in for receiver replies using statuses `PENDING` and `SENT`
  - marks check-ins `RESPONDED_OK` or `RESPONDED_HELP` with encrypted response transcripts

Backend env/provider settings:

- Local `apps/backend/.env` exists and is ignored by git.
- Backend startup loads local `.env` through `dotenv/config` in `apps/backend/src/main.ts`.
- Backend CORS currently allows Expo web localhost origins:
  - `http://localhost:8081`
  - `http://127.0.0.1:8081`
- `CHANNEL_PROVIDER_MODE`
  - `fake` for local full-journey testing without credentials
  - `configured` for Twilio-backed provider adapters
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_SMS_FROM_NUMBER`
- `TWILIO_WHATSAPP_FROM_NUMBER`
- `TWILIO_VOICE_FROM_NUMBER`
- `PUBLIC_API_BASE_URL`
- These are documented in `apps/backend/.env.example`.
- `.gitignore` now explicitly ignores common provider credential/secret dump file patterns in addition to existing `.env` protection.
- Prisma 7 runtime uses `@prisma/adapter-pg` in `PrismaService`, passing `AppConfigService.databaseUrl` explicitly.

Twilio voice check-in research pivot - added 2026-05-10:

- Research sources:
  - Twilio `<Gather>` docs confirm DTMF/speech collection and allow nested `<Play>` or `<Say>` verbs.
  - Twilio docs specifically recommend S3-style regional hosting and cache-control headers for `<Play>` media, but warn that nested MP3 playback can add transcoding delay and recommend WAV for nested `<Play>` where possible.
  - Twilio Calls API supports outbound calls using either an absolute `url` that returns TwiML, inline `twiml`, or an Application SID.
  - Twilio Calls API supports `statusCallback` for call lifecycle status.
  - Twilio Trust Hub / SHAKEN-STIR docs confirm business profile + SHAKEN/STIR Trust Product onboarding for outbound voice trust.
- Verdict on the provided BRD snippet:
  - Core approach is correct and implementable for Nearby.
  - Cron/task queue initiating Twilio outbound Calls API is the right trigger model.
  - `<Gather numDigits="1" timeout="10" action="...">` wrapping hosted static audio is correct.
  - Dynamic language-based audio URL selection is a good fit for receiver profile language.
  - DTMF `1` / `2` maps cleanly onto our existing receiver reply flow, which already treats `1` as OK and `2` as HELP on voice channel replies.
  - Using pre-generated ElevenLabs audio avoids real-time TTS latency and keeps runtime costs predictable.
- Corrections / cautions:
  - Prefer WAV over MP3 for nested `<Play>` if practical, because Twilio docs warn MP3 transcoding can add delay in `<Gather>` playback.
  - Do not depend on a "Messaging/Voice Service SID" to rotate outbound caller ID in the current Programmable Voice Calls API path. Our current implementation uses the `From` value per call. Number pooling should be modeled as a configured pool of Twilio/verified caller IDs that our `VoiceProvider` selects from, then passes as `From`.
  - Number pooling is not a substitute for consent, quiet hours, opt-out, or carrier reputation. At scale we still need Trust Hub, SHAKEN/STIR, CNAM/Branded Calling where available, low complaint rates, and careful call cadence.
  - SHAKEN/STIR onboarding is Console/Trust Hub work, not app code, but the app should track provider status callbacks and failure rates.
- Current code fit:
  - `VoiceProvider` already calls Twilio Calls API with `To`, `From`, and inline `Twiml`.
  - `renderTwilioVoiceTwiml` currently uses `<Gather ...><Say>{scriptKey}</Say></Gather>`.
  - `ProviderWebhooksController.handleTwilioVoiceWebhook` already validates Twilio signatures and normalizes `Digits`/`SpeechResult` into `ReceiverReplyService`.
  - Existing reply parser already handles voice `1` as `RESPONDED_OK` and `2` as `RESPONDED_HELP`.
- Recommended implementation slice when we pivot from payment to Twilio voice:
  1. Add config for static voice asset base URL, e.g. `VOICE_AUDIO_BASE_URL`.
  2. Store production audio as phone-optimized WAV assets, preferably 8 kHz, 16-bit, mono. Twilio supports MP3, but use WAV for nested `<Play>` to avoid MP3 transcoding delay.
  3. Add a voice prompt resolver that maps `{ scriptKey, language }` to URLs such as `{baseUrl}/{language}/check-in.wav`, with fallback to English.
  4. Change TwiML rendering from `<Say>` to `<Play>` inside `<Gather>`, keeping `numDigits="1"`, `timeout="10"`, `method="POST"`, and signed Twilio action URL.
  5. Implement the no-input loop in TwiML: play/gather once, repeat the same prompt once if no digit is received, then hang up gracefully and route the attempt into retry/no-response logic.
  6. Add Twilio call `StatusCallback` URL and controller handling for `completed`, `busy`, `failed`, and `no-answer`.
  7. Implement retry scheduling: wait 15 minutes, max 2 retries, never outside receiver quiet hours/local policy.
  8. Add database-backed caller-ID pool logic before scaling: `VoiceProvider` should select a compliant Twilio/verified `From` number from the pool before calling Twilio. Pool entries need active/disabled state, corridor/country metadata, compliance/trust registration status, and basic usage counters.
  9. Make caller-ID assignment sticky per receiver. Do not randomly rotate on every call. Store the assigned caller ID on a receiver voice assignment row, or equivalent, so the same receiver normally sees the same `From` number on future calls. Only reassign when the number is disabled, no longer compliant for the corridor, or operational failover requires it.
  10. Reuse existing `check_ins` and `check_in_attempts` as the call-log backbone rather than adding a separate generic `CallLog` table. Voice calls are channel attempts in the cascade, and `providerMessageId` can carry Twilio `CallSid`.
  11. For retry state, persist provider status/failure reason on the voice attempt and schedule attempt 2 after 15 minutes, attempt 3 after 30 minutes, then stop calling and notify the sender.
  12. Use Supabase Cron/pg_cron only as a durable due-worker trigger, not as a per-receiver retry loop. Supabase Cron can run every minute or call an Edge Function; at higher scale, move retry dispatch behind BullMQ/SQS-style queues while keeping the same repository contracts.
  13. For 1M/day scale, plan monthly/date-range partitioning for large append-only tables such as `check_in_attempts`, provider events, and audit/event logs. Prisma schema can own the logical model, but partitioning/retention should be managed by explicit SQL migrations because Postgres partitioning is not fully expressed by Prisma models.
  14. Add retention/TTL policy: keep hot attempt/provider logs lean, index by `status` and `scheduledAt`/`createdAt`, and export/archive records older than the retention window, e.g. 90 days, to cold storage before pruning.
  15. Update tests first for TwiML output, no-input loop, sticky caller-ID pool selection, webhook normalization, status callbacks, retry caps, and retention query behavior before changing provider behavior.
- Multi-channel escalation addendum:
  - Do not add the sample `CheckInSession` model literally. Our existing `check_ins` row is the daily session, and `check_in_attempts` are the channel attempts.
  - Any OK response from any channel must atomically move the session to terminal success (`RESPONDED_OK` in the current schema) and cancel/skip all pending attempts, delayed retries, and escalation jobs.
  - Any HELP response must move the check-in to `RESPONDED_HELP` and trigger sender/backup escalation.
  - Enable Twilio AMD for voice attempts with `MachineDetection` and record `AnsweredBy`/AMD callback metadata. Machine/fax/unknown must not count as a human OK response; only DTMF/speech/input does.
  - WhatsApp daily check-ins should use approved Content Template quick-reply buttons. Twilio can return button text/payload fields in inbound webhooks; backend should normalize stable OK/HELP payloads instead of relying only on localized display text.
  - Sender escalation siren should be high-priority push plus deep link to incident/status. Baseline is iOS Time Sensitive where available and Android `IMPORTANCE_HIGH` emergency notification channel.
  - iOS Critical Alerts require Apple entitlement approval and user critical-alert authorization before the app/server can use critical interruption level/sound behavior. If not approved or not authorized, fall back to Time Sensitive push plus a Twilio voice call to the sender/member.
  - Android DND bypass requires notification policy/channel support and cannot be assumed from high priority alone. Create an Emergency Alert channel with bundled siren sound, request bypass only where allowed, detect channel `canBypassDnd`, and deep-link users to channel notification settings during onboarding if needed.
  - Add a "Test my siren" settings control before launch so senders can verify alert sound/volume and platform permissions on their own device.
  - If sender/member does not acknowledge the siren within 5 minutes, alert configured local backup contacts over WhatsApp/SMS with the incident context.
  - Cost estimate for a full non-response path should be tracked as a planning assumption, not a constant: roughly three voice calls plus WhatsApp/SMS/escalation notifications, varying by country and provider pricing.

Twilio credential-readiness slice completed 2026-05-10:

- `VOICE_AUDIO_BASE_URL` is now a backend config/env value, trimmed like `PUBLIC_API_BASE_URL`.
- `VoiceProvider` now starts Twilio calls with:
  - hosted WAV `<Play>` prompts inside `<Gather input="dtmf" numDigits="1" timeout="10">`
  - one no-input repeat before `<Hangup/>`
  - `MachineDetection=Enable`
  - async AMD callback URL `/provider-webhooks/twilio/voice/amd`
  - call status callback URL `/provider-webhooks/twilio/voice/status`
  - status callback events `initiated ringing answered completed`
- Voice prompt URL shape is `{VOICE_AUDIO_BASE_URL}/{language}/{scriptKey}.wav`, with supported language folders `en`, `ar`, `es`, `hi`, `ur`, and fallback to `en`.
- Twilio WhatsApp inbound webhooks now prefer stable `ButtonPayload`, then `ButtonText`, then `Body`, so localized button labels do not break OK/HELP parsing.
- Twilio voice AMD and status callback endpoints now exist and validate Twilio signatures. They intentionally do not create receiver replies; persistence into `provider_webhook_events` is the next slice.
- Prisma schema and SQL migration `202605100001_twilio_voice_readiness` now add:
  - `voice_caller_id_pool`
  - `receiver_voice_caller_id_assignments`
  - `provider_webhook_events`
  - BRIN indexes for append-heavy `check_in_attempts.scheduledAt`, `audit_logs.createdAt`, `escalation_events.startedAt`, and provider event `createdAt`
- This is not a full partition conversion yet. Existing large tables are now better prepared for high-volume scans, but true monthly/date-range partitioning should be a separate explicit SQL migration before 30M+/month live volume.

Verification after Twilio credential-readiness slice:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/channels/configured-channel-providers.spec.ts src/modules/provider-webhooks/provider-webhooks.controller.spec.ts src/shared/config/app-config.service.spec.ts
npm.cmd --prefix apps/backend run type-check
npx.cmd prisma validate --schema apps/backend/prisma/schema.prisma
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
```

Verified results:

- Focused Twilio/config specs passed: 3 files, 22 tests.
- Backend type-check passed.
- Prisma schema validation passed.
- Full backend suite passed: 42 files, 197 tests.
- Backend build passed.

Remaining Twilio work before live credentials:

- Add sender siren fallback voice call flow.
- Add iOS Critical Alerts entitlement-gated path, Android DND onboarding/settings support, custom siren sound, and "Test my siren".
- Add real Twilio sandbox/live smoke tests after account credentials and compliant sender numbers are available.

Sticky Twilio caller-ID selection completed 2026-05-10:

- Added optional per-call voice provider options with `fromNumber`.
- `ChannelRouterService.makeVoiceCall(...)` now passes voice call options through to the registered provider.
- `VoiceProvider` now uses `options.fromNumber` when present and falls back to configured `TWILIO_VOICE_FROM_NUMBER` when no sticky caller ID is available.
- `FakeChannelProvider` records voice call options for tests.
- Added `VoiceCallerIdRepository` and `PrismaVoiceCallerIdRepository`.
- `PrismaVoiceCallerIdRepository.resolveForReceiver(...)` behavior:
  - reuses an active unreleased `receiver_voice_caller_id_assignments` row when one exists.
  - otherwise selects the least-used active `voice_caller_id_pool` row for the receiver country.
  - creates the receiver assignment, increments `assignedCount`, and updates `lastAssignedAt`.
  - returns `undefined` when no active caller ID is available, allowing the configured Twilio fallback number to be used.
- `CheckInsService` now resolves sticky caller IDs before voice calls for both initial due check-ins and later cascade attempts.
- Receiver/check-in attempt records now carry receiver `countryCode` into the voice dispatch path.

Verification after sticky Twilio caller-ID selection:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/channels/configured-channel-providers.spec.ts src/modules/channels/channel-router.service.spec.ts src/modules/check-ins/check-ins.service.spec.ts src/modules/check-ins/prisma-voice-caller-id.repository.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
npx.cmd prisma validate --schema apps/backend/prisma/schema.prisma
```

Verified results:

- Focused sticky caller-ID specs passed: 4 files, 24 tests.
- Backend type-check passed.
- Full backend suite passed: 44 files, 206 tests.
- Backend build passed.
- Prisma schema validation passed.

Twilio AMD/status callback persistence completed 2026-05-10:

- Added `ProviderWebhookEventsRepository` and `PrismaProviderWebhookEventsRepository`.
- Provider webhook module now injects the repository using `PROVIDER_WEBHOOK_EVENTS_REPOSITORY`.
- Twilio voice status callback route now persists a `provider_webhook_events` row:
  - `provider = twilio`
  - `eventType = voice_status`
  - `providerEventId = {CallSid}:{CallStatus}` when status is present
  - `providerMessageId = CallSid`
  - raw Twilio callback body in `payload`
- Twilio AMD callback route now persists a `provider_webhook_events` row:
  - `provider = twilio`
  - `eventType = voice_amd`
  - `providerEventId = {CallSid}:{AnsweredBy}` when AMD result is present
  - `providerMessageId = CallSid`
  - raw Twilio callback body in `payload`
- Repository attempts to link the event to the latest `check_in_attempts` row whose `providerMessageId` matches the Twilio `CallSid`; events are still stored if the attempt is not found.
- AMD/status callbacks intentionally do not create receiver replies. Only DTMF/speech/input route through `ReceiverReplyService`.
- Regenerated Prisma Client after adding `providerWebhookEvent` to the schema.

Verification after Twilio AMD/status callback persistence:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/provider-webhooks/provider-webhooks.controller.spec.ts src/modules/provider-webhooks/prisma-provider-webhook-events.repository.spec.ts
npm.cmd --prefix apps/backend run prisma:generate
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
npx.cmd prisma validate --schema apps/backend/prisma/schema.prisma
npm.cmd --prefix apps/backend test
```

Verified results:

- Focused provider-webhook specs passed: 2 files, 13 tests.
- Prisma Client generated successfully.
- Backend type-check passed.
- Backend build passed.
- Prisma schema validation passed.
- Full backend suite passed: 43 files, 199 tests.

Supabase partitioned operational logs migration applied 2026-05-10:

- Created explicit SQL migration `supabase/migrations/20260510181345_partitioned_operational_logs.sql`.
- Applied to Supabase project `<project-ref, see apps/backend/.env>` through the backend `DATABASE_URL` using Node `pg`.
- Supabase MCP was connected but returned `ReauthenticationRequired: 401`; Supabase CLI could reach the DB but `supabase db push` was blocked by remote migration-history drift, so the SQL was applied directly.
- Applied prerequisites first because live Supabase did not yet have `check_in_attempts`:
  - `apps/backend/prisma/migrations/202605010001_check_in_attempts/migration.sql`
  - `apps/backend/prisma/migrations/202605100001_twilio_voice_readiness/migration.sql`
- Live DB verification after apply:
  - `provider_webhook_events` is a native partitioned table with RLS enabled.
  - `check_in_attempts_archive`, `audit_logs_archive`, and `escalation_events_archive` are native partitioned archive tables with RLS enabled.
  - each partitioned parent currently has 25 partitions: 24 monthly partitions plus the default partition.
  - `voice_caller_id_pool` and `receiver_voice_caller_id_assignments` have RLS enabled and no client policies, intentionally backend-only.
  - `provider_webhook_events` has RLS enabled and no client policies, intentionally backend-only.
  - `check_in_attempts_archive` has owner/co-monitor read policies matching hot `check_in_attempts`.
  - `audit_logs_archive` has owner audit-log read policy matching hot `audit_logs`.
  - `archive_operational_logs_before(timestamp)` exists for trusted maintenance jobs.
- Design boundary remains intentional:
  - hot Prisma tables keep UUID-only primary keys for application compatibility.
  - provider webhook telemetry is partitioned now because it is new/high-volume.
  - old attempts/audit/escalations should be moved into partitioned archive tables by a trusted retention job rather than converting hot tables in-place during normal app work.

Verification after Supabase partition apply:

```powershell
npx.cmd prisma validate --schema apps/backend/prisma/schema.prisma
npm.cmd --prefix apps/backend run type-check
```

Verified results:

- Prisma schema validation passed.
- Backend type-check passed.

Implemented mobile behavior:

- `backendApi`
  - uses `EXPO_PUBLIC_BACKEND_URL`
  - reads the existing Supabase session via `getSession`
  - sends `Authorization: Bearer <access_token>` to the backend
  - exposes `syncAuthenticatedUser()` for `POST /auth/sync-user`
  - exposes `createReceiver()` for `POST /receivers`
- Login screen
  - no longer reads `public.users.onboarding_completed` directly from Supabase
  - calls `syncAuthenticatedUser()` after email/password sign-in
  - routes to the new receiver setup screen
- Signup screen
  - attempts backend sync when a session exists
  - routes to the new receiver setup screen
- Receiver setup screen
  - replaced the old relationship-only onboarding screen
  - collects receiver name, phone, country, relationship, channel profile, language, timezone, check-in window, and personal note
  - calls backend `POST /receivers`, which creates the receiver and triggers the fake-provider consent request in local mode
- Removed stale old onboarding route group and context:
  - `apps/mobile/src/app/(onboarding)`
  - `apps/mobile/src/contexts/OnboardingContext.tsx`
- Protected mobile auth core files were not edited in this mobile slice.

Tests:

- `apps/backend/src/shared/crypto/crypto.service.spec.ts`
- `apps/backend/src/shared/config/app-config.service.spec.ts`
- `apps/backend/src/shared/phone/phone-normalizer.spec.ts`
- `apps/backend/src/modules/audit/audit.service.spec.ts`
- `apps/backend/src/modules/audit/prisma-audit.repository.spec.ts`
- `apps/backend/src/modules/auth/auth.controller.spec.ts`
- `apps/backend/src/modules/auth/supabase-auth.service.spec.ts`
- `apps/backend/src/modules/check-ins/check-ins.service.spec.ts`
- `apps/backend/src/modules/check-ins/prisma-check-ins.repository.spec.ts`
- `apps/backend/src/modules/channels/channel-providers.factory.spec.ts`
- `apps/backend/src/modules/channels/channel-router.service.spec.ts`
- `apps/backend/src/modules/channels/configured-channel-providers.spec.ts`
- `apps/backend/src/modules/channels/fake-channel.provider.spec.ts`
- `apps/backend/src/modules/receivers/receiver-consent.service.spec.ts`
- `apps/backend/src/modules/receivers/receiver-replies.controller.spec.ts`
- `apps/backend/src/modules/receivers/receiver-reply.service.spec.ts`
- `apps/backend/src/modules/receivers/receivers.controller.spec.ts`
- `apps/backend/src/modules/receivers/receivers.service.spec.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.spec.ts`
- `apps/backend/src/modules/users/users.service.spec.ts`

Latest backend verification passed:

- `npm.cmd --prefix apps/backend test` - 20 files, 51 tests passed on 2026-04-27
- `npm.cmd --prefix apps/backend run type-check` - passed on 2026-04-27
- `npm.cmd --prefix apps/backend run build` - passed on 2026-04-27
- `$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate` - passed on 2026-04-27
- Backend dev server started successfully on port `3000` on 2026-04-26.
- `POST http://localhost:3000/auth/sync-user` without bearer token returned `401`, confirming Nest is reachable and auth guard behavior is active.
- Backend local E2E fake flow passed on 2026-04-27 against hosted Supabase:
- logged in as an existing Supabase Auth test user; email intentionally omitted from source-controlled docs
  - added `user_metadata.phone` for the test user so backend sender sync can satisfy phone requirements while Supabase phone auth remains disabled
  - `POST /auth/sync-user` returned sender profile `a3462046-7887-494e-a0f5-9725912760b3`
  - created two disposable fake receivers:
    - OK path receiver `d4b39c43-3fa6-4b71-b696-e4dc1d1b7cce`
    - HELP path receiver `c2852756-939f-4c9f-9f01-5580fcc7d15c`
  - simulated `YES` consent for both through `POST /receiver-replies/fake`
  - invoked `CheckInsService.sendDueCheckIns()` locally; result was `{ "created": 2, "sent": 2, "skipped": 0 }`
  - simulated `OK`; check-in `49a43e47-4e21-46f1-9fcc-2cf81ca3b41d` became `RESPONDED_OK` with `responseDetectedAs = ok`
  - simulated `HELP`; check-in `7335aad5-fe23-4568-87dd-2d893f7b8191` became `RESPONDED_HELP` with `responseDetectedAs = help`

Latest mobile verification:

- `npm.cmd --prefix apps/mobile run type-check` - passed on 2026-04-26
- Expo web smoke test passed on 2026-04-26 at `http://localhost:8081`:
  - upgraded Expo packages to expected SDK patch versions (`expo`, `expo-router`, `expo-font`)
  - fixed `apps/mobile/metro.config.js` monorepo root so Metro can resolve `expo-router/entry-classic`
  - `EXPO_PUBLIC_BACKEND_URL` is now set locally in `apps/mobile/.env`
  - Expo web restarted and confirmed it exports `EXPO_PUBLIC_BACKEND_URL`
  - app boots to the welcome/login UI
  - fake email/password login returns `Invalid login credentials`, confirming the mobile Supabase client reaches Supabase Auth
- Supabase Auth connectivity check passed on 2026-04-26:
  - `apps/mobile/.env` exists locally and is ignored
  - `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are present
  - Supabase `/auth/v1/settings` responded successfully with the anon key
  - Email auth is enabled
  - Signup is allowed
  - Phone auth is currently disabled in Supabase Auth settings
- Current local full-journey gap:
  - Backend and Expo are configured and running locally.
  - A successful sign-in -> backend sync -> receiver creation test still requires a valid Supabase test user.
  - Do not read `Credentials.xlsx` unless the user explicitly asks; use a test account provided in chat or create a safe test account through the UI if approved.

Mobile type-check cleanup completed:

- Kept Supabase Auth as the auth provider for login, signup, reset password, Google, and Apple.
- Added `resetPassword` alias to `useAuth` so the forgot-password screen matches the hook API.
- Added reusable `ScreenHeader` component used by settings/security.
- Added `warningLight` theme token.
- Allowed auth `Button` to accept a `style` prop.
- Reworked `useProfile` to read/update Supabase Auth user metadata instead of the removed old public `users` profile shape.
- Updated user data export file writing to the current Expo FileSystem `File` / `Paths` API.

Generated build output:

- `apps/backend/dist` is recreated by `npm.cmd --prefix apps/backend run build`.
- It was deleted after verification to keep the working tree clean.

## Git / Working Tree Notes

Project git workflow:

- Solo project, but `master` is protected by the `protect-master` ruleset (since 2026-09-05): direct pushes are blocked, a pull request is required, and the CI checks (Verify, Security scans, Dependency review, Analyse, Database invariants) must pass. Zero approvals are required.
- Work on a short-lived branch. After completing a task and updating this handoff: `npm run verify`, commit, push the branch, `gh pr create --fill`, wait for the checks, then `gh pr merge --squash --delete-branch`.
- Git hooks are installed by `npm install` (`scripts/install-hooks.mjs`): pre-commit scans staged files for secrets and formats them with Prettier; pre-push runs gitleaks (Docker), lint, and typecheck.
- Still inspect `git status`, avoid committing ignored/local secret files, and keep generated `apps/backend/dist` out of source control.

Pre-existing user/local changes before restructure:

- `.claude/settings.local.json`
- `Business Requirements Document.txt`

The folder move appears in Git as old `frontend`, `backend`, and `shared` files deleted, with new `apps/` and `packages/` files untracked until staged.

Do not revert unrelated user changes.

## CI, Security And Test Gates (Added 2026-09-05)

Full description: `docs/SECURITY.md`. Summary:

- `.github/workflows/ci.yml`: **Verify** (npm ci, prisma generate, lint, typecheck, prisma validate, build, all Vitest projects with coverage thresholds) and **Security scans** (gitleaks, workflow hygiene, secret pattern scan, production dependency audit with `security/dependency-audit-allowlist.json`, zizmor) plus **Dependency review** on PRs.
- `.github/workflows/codeql.yml` (**Analyse**, weekly too), `.github/workflows/database.yml` (**Database invariants**: migrations + RLS SQL on a throwaway Postgres, RLS/policy/grant assertions, schema drift), `.github/workflows/security-weekly.yml` (full-history gitleaks, Trivy, SBOM).
- All actions SHA-pinned; `scripts/github-actions-security-check.mjs` fails CI otherwise. Dependabot keeps pins and npm deps current (weekly, grouped; Expo/React Native majors excluded).
- Root scripts: `npm run verify` (everything CI runs), `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run security:workflows`, `npm run security:secrets`, `npm run security:deps`, `npm run security:gitleaks`, `npm run format`.
- Tests: one root `vitest.config.ts` with projects `backend`, `mobile`, `shared-types`, `scripts`; `npm test` runs all of them. Coverage thresholds are a ratchet from the 2026-09-05 baseline.
- Backend HTTP hardening: helmet, global rate limit (`RATE_LIMIT_*`, `TRUST_PROXY`), CORS allow-list (`CORS_ALLOWED_ORIGINS`); cron route and provider webhooks are exempt from throttling.
- Still open (see `docs/SECURITY.md` section 7): rotate the test-account password and the Supabase token/DB password that were exposed earlier; enable Supabase leaked-password protection; re-enable the check-in scheduler workflow once hosted; Prettier `format:check` becomes a CI gate after a one-off formatting commit.

## Cleanup Already Done

Deleted obsolete/generated backend artifacts:

- `apps/backend/supabase`
- `apps/backend/apps`
- `apps/backend/dist`

Documentation cleanup:

- Replaced the stale root `README.md` with a Nearby-focused README covering product model, non-negotiables, current stack, setup, common commands, fake local flow, protected auth boundary, and next work.

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
- provider credential/secret dump patterns
- credential spreadsheets such as `*Credentials*.xlsx`
- Office temp files such as `~$*`

`.env.example` files are intentionally allowed.

Known local secret file:

- `apps/mobile/.env` exists locally and is ignored.
- `Credentials.xlsx` and `~$Credentials.xlsx` exist locally and are ignored.

## Known Issues / Risks

Mobile type-check is currently clean. Some old mobile screens still refer to loved-one/check-in concepts and should be deleted or replaced as the new BRD receiver/check-in dashboard is built.

Expo web currently logs non-blocking warnings:

- Root stack warns that `auth/callback` and `auth/reset-password` are nested route names. The routes exist, but root stack registration should be cleaned up later.
- React Native Web logs `Unexpected text node: . A text node cannot be a child of a <View>` while rendering auth screens. This does not block native auth or the Supabase smoke test, but should be cleaned up during mobile UI polish.
- React Native Web warns that legacy `shadow*` style props are deprecated in favor of `boxShadow`.

npm audit currently reports vulnerabilities. Do not run broad `npm audit fix --force` casually; handle dependency audit deliberately after the foundation stabilizes.

After installing `@prisma/adapter-pg`, npm audit reported 5 vulnerabilities (4 moderate, 1 high).

Prisma 7 note:

- `DATABASE_URL` lives in `apps/backend/prisma.config.ts`, not inside `schema.prisma`.
- Use a temporary/dummy `DATABASE_URL` for local schema validation when not connecting to a real DB.

## Next Session Plan

Start the next session by reading this handoff, then continue with the BRD core workflow. Do not start with real channel vendors yet; keep using `CHANNEL_PROVIDER_MODE=fake` until the local end-to-end flow is proven.

### 0. Completion backlog first (added 2026-09-05)

Four independent audits (backend wiring, backend robustness, mobile wiring, BRD coverage) were run on 2026-09-05. The consolidated, prioritised result is `docs/COMPLETION_BACKLOG.md`; the raw reports are in `docs/audits/2026-09-05/`. Rule agreed with the founder: work the backlog top to bottom (Phase 0 safety-loop blockers, then Phase 1 completing the built journeys) and do not start a new BRD feature until the items for the built ones are done, with their tests. The slice notes below remain the history of how things were built, not the plan.

### 1. Scheduled check-in engine foundation - completed 2026-04-27

Completed backend slice:

- Added `CheckInsModule`.
- Added `CheckInsService` with tests first.
- Added repository methods for:
  - finding receivers eligible for check-in where `consentStatus = GRANTED`, not deleted, not paused, and receiver-local schedule window is due
  - excluding receivers that already have a check-in on the current UTC day to prevent repeated sends during a worker window
  - creating `check_ins` rows
  - marking check-ins `SENT`
- Sends check-ins through `ChannelRouterService` and fake providers first.
- Writes safe audit events:
  - `check_in.created`
  - `check_in.sent`
- Keeps raw phone numbers out of audit metadata; phone decryption happens only at the channel send boundary.

Focused tests:

```powershell
npm.cmd --prefix apps/backend test -- check-ins.service.spec.ts
npm.cmd --prefix apps/backend test -- prisma-check-ins.repository.spec.ts
```

Behavior now covered:

- Given a granted receiver with a due daily schedule, service creates one `PENDING` check-in.
- Service sends via primary channel using fake provider.
- Service marks it `SENT`.
- Service does not create/send check-ins for `PENDING`, `DECLINED`, `REVOKED`, paused, or deleted receivers.
- Repository evaluates due windows in receiver local timezone.

### 2. Check-in response ingestion - completed 2026-04-27

Completed backend slice:

- Extended `ReceiverReplyService` so replies from granted receivers update the latest open check-in instead of being treated as consent transitions.
- Added `CheckInsRepository.findLatestOpenForReceiver`.
- Added `CheckInsRepository.markResponded`.
- `RESPONDED_OK` replies:
  - `1`
  - `OK`
  - `YES`
  - `I'M FINE`
  - `IM FINE`
  - `I AM FINE`
- `RESPONDED_HELP` replies:
  - `2`
  - `HELP`
  - `NEED HELP`
- Existing `STOP` opt-out and `REPORT` abuse behavior remains intact.
- Response transcripts are encrypted.
- Audit metadata remains free of raw phone numbers, names, message bodies, notes, and transcripts.

Focused tests:

```powershell
npm.cmd --prefix apps/backend test -- receiver-reply.service.spec.ts prisma-check-ins.repository.spec.ts
```

### 3. Local backend end-to-end fake flow - completed 2026-04-27

Completed validation slice:

- Ran backend locally on port `3000`.
- Used an existing Supabase Auth test user; email intentionally omitted from source-controlled docs.
- Synced sender profile through `POST /auth/sync-user`.
- Created disposable receivers through `POST /receivers`.
- Confirmed backend creates receiver and fake consent request.
- Simulated consent reply:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/receiver-replies/fake -ContentType 'application/json' -Body '{"fromPhone":"+971500000000","channel":"WHATSAPP","body":"YES","providerMessageId":"local-consent-1"}'
```

- Invoked `CheckInsService.sendDueCheckIns()` directly through a one-off `tsx` command.
- Simulated check-in OK reply and verified the latest open check-in became `RESPONDED_OK`.
- Simulated check-in HELP reply and verified the latest open check-in became `RESPONDED_HELP`.

### 4. Mobile end-to-end smoke test - completed 2026-04-27

Completed validation slice:

- Started backend dev server on port `3000`.
- Started Expo web on port `8081` with `EXPO_PUBLIC_BACKEND_URL` loaded from `apps/mobile/.env`.
- Signed in through the actual Expo web UI with the existing Supabase test user.
- Login reached the authenticated dashboard.
- Found and fixed a navigation gap:
  - authenticated users were redirected away from `/(auth)/onboarding`
  - dashboard/sidebar "Add Loved One" still opened the old pairing placeholder
  - added `/(main)/receiver-setup` that reuses the existing backend-backed receiver form
  - pointed dashboard and sidebar "Add Loved One" actions to `/(main)/receiver-setup`
- Created a receiver through the Expo web UI:
  - phone `+971500000000`
  - receiver id `aae5f5ea-dd86-459f-9b7b-be6b07b2c08c`
  - schedule window `00:00` to `23:59`
- Simulated receiver consent via fake webhook; result `consent_granted`.
- Invoked `CheckInsService.sendDueCheckIns()`; result `{"created":1,"sent":1,"skipped":0}`.
- Simulated an `OK` reply via fake webhook:
  - check-in id `e8bfbd5a-0073-427e-a053-ef3eeaed1045`
  - final status `RESPONDED_OK`

Files changed for the Expo route fix:

- `apps/mobile/src/app/(main)/receiver-setup.tsx`
- `apps/mobile/src/app/(main)/_layout.tsx`
- `apps/mobile/src/app/(main)/index.tsx`
- `apps/mobile/src/components/layout/Sidebar.tsx`

Focused verification:

```powershell
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend test
```

Remaining UI gap:

- The receiver creation form now works from the authenticated app, but the dashboard list still reads old Supabase `loved_one_profiles` data through `useLovedOnes`.
- Newly created backend receivers do not appear on the dashboard yet.
- Next mobile slice should replace `useLovedOnes` / old loved-one screens with backend receiver/check-in status APIs or add those backend read APIs first.

### 5. Mobile cleanup after backend check-ins

First completed slice - 2026-04-27:

- Added authenticated backend read API:
  - `GET /receivers`
  - verifies Supabase bearer token
  - syncs sender profile through `UsersService`
  - returns only non-deleted receivers owned by the sender
  - includes decrypted display name, masked phone, consent/schedule/channel fields, and latest check-in summary
  - does not expose encrypted fields, phone hash, full phone number, transcripts, or personal notes
- Added repository support:
  - `ReceiversRepository.findManyForUser`
  - Prisma query includes the latest check-in via `checkIns orderBy scheduledAt desc take 1`
- Updated Expo data layer:
  - `listReceivers()` in `apps/mobile/src/services/backendApi.ts`
  - `useLovedOnes` now reads backend receivers instead of old Supabase `loved_one_profiles`
  - dashboard cards now show real backend receivers and statuses such as `OK`, `Needs help`, `Awaiting reply`, and `Pending`
- Verified in Expo web that dashboard now shows backend-created receivers:
  - `Expo Smoke Receiver` with `OK`
  - prior fake E2E receivers with `OK` / `Needs help`

Files changed for this slice:

- `apps/backend/src/modules/receivers/receivers.controller.ts`
- `apps/backend/src/modules/receivers/receivers.controller.spec.ts`
- `apps/backend/src/modules/receivers/receivers.service.ts`
- `apps/backend/src/modules/receivers/receivers.service.spec.ts`
- `apps/backend/src/modules/receivers/receivers.repository.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.spec.ts`
- `apps/backend/src/modules/receivers/receiver-consent.service.spec.ts`
- `apps/backend/src/modules/receivers/receiver-reply.service.spec.ts`
- `apps/mobile/src/services/backendApi.ts`
- `apps/mobile/src/services/index.ts`
- `apps/mobile/src/hooks/useLovedOnes.ts`
- `apps/mobile/src/app/(main)/index.tsx`

Verification:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
npm.cmd --prefix apps/mobile run type-check
```

`apps/backend/dist` was removed after build verification to keep the working tree clean.

Remaining work for this cleanup area:

Second completed slice - 2026-04-27:

- Added authenticated backend receiver detail API:
  - `GET /receivers/:receiverId`
  - verifies Supabase bearer token
  - syncs sender profile through `UsersService`
  - scopes lookup by both `userId` and `receiverId`
  - returns `404` when the receiver is missing or not owned by the sender
  - includes latest check-in summary plus backup-contact/escalation placeholders
  - keeps encrypted fields, phone hash, full phone, transcripts, and personal notes out of the response
- Added repository support:
  - `ReceiversRepository.findForUserById`
  - Prisma query includes latest check-in via `checkIns orderBy scheduledAt desc take 1`
- Added Expo detail route:
  - `apps/mobile/src/app/(main)/receivers/[id].tsx`
  - dashboard receiver cards now navigate to `/(main)/receivers/:id`
  - detail screen shows consent/current status, latest check-in, schedule, channels, backup contact placeholder, and future action placeholders
- Verified in Expo web:
  - dashboard loads backend receivers
  - tapping `Expo Smoke Receiver` opens receiver detail
  - detail screen shows masked phone `*******4894`, latest `Responded Ok`, schedule `00:00 - 23:59`, primary `Whatsapp`, fallbacks `Sms, Voice`, and backup contacts placeholder

Files changed for this slice:

- `apps/backend/src/modules/receivers/receivers.controller.ts`
- `apps/backend/src/modules/receivers/receivers.controller.spec.ts`
- `apps/backend/src/modules/receivers/receivers.service.ts`
- `apps/backend/src/modules/receivers/receivers.service.spec.ts`
- `apps/backend/src/modules/receivers/receivers.repository.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.spec.ts`
- `apps/backend/src/modules/receivers/receiver-consent.service.spec.ts`
- `apps/backend/src/modules/receivers/receiver-reply.service.spec.ts`
- `apps/mobile/src/services/backendApi.ts`
- `apps/mobile/src/services/index.ts`
- `apps/mobile/src/app/(main)/_layout.tsx`
- `apps/mobile/src/app/(main)/index.tsx`
- `apps/mobile/src/app/(main)/receivers/[id].tsx`

Verification:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
npm.cmd --prefix apps/mobile run type-check
```

`apps/backend/dist` was removed after build verification to keep the working tree clean.

Third completed slice - 2026-04-27:

- Added receiver pause/resume management:
  - `PATCH /receivers/:receiverId/pause`
  - `PATCH /receivers/:receiverId/resume`
  - both verify Supabase bearer token and scope updates by `userId + receiverId + deletedAt: null`
  - missing/not-owned receivers return `404`
  - pause sets `pausedUntil` to `9999-12-31T23:59:59.999Z` and `pausedReason` to `USER_PAUSED`
  - resume clears `pausedUntil` and `pausedReason`
- Added audit events:
  - `receiver.paused`
  - `receiver.resumed`
  - metadata excludes PII and message/transcript fields
- Added Prisma repository support:
  - `pauseForUserById`
  - `resumeForUserById`
  - uses ownership-scoped `updateMany` with `deletedAt: null` before reloading the receiver detail
- Updated Expo:
  - `pauseReceiver()`
  - `resumeReceiver()`
  - receiver detail `Pause` button now toggles to `Resume`
  - detail and dashboard status render `Paused` when `pausedReason` or `pausedUntil` is present
- Verified in Expo web:
  - opened `Expo Smoke Receiver`
  - clicked `Pause`
  - detail status changed to `Paused`
  - button changed to `Resume`
  - clicked `Resume`
  - status returned to `OK`
  - button changed back to `Pause`

Files changed for this slice:

- `apps/backend/src/modules/receivers/receivers.controller.ts`
- `apps/backend/src/modules/receivers/receivers.controller.spec.ts`
- `apps/backend/src/modules/receivers/receivers.service.ts`
- `apps/backend/src/modules/receivers/receivers.service.spec.ts`
- `apps/backend/src/modules/receivers/receivers.repository.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.spec.ts`
- `apps/backend/src/modules/receivers/receiver-consent.service.spec.ts`
- `apps/backend/src/modules/receivers/receiver-reply.service.spec.ts`
- `apps/mobile/src/services/backendApi.ts`
- `apps/mobile/src/services/index.ts`
- `apps/mobile/src/hooks/useLovedOnes.ts`
- `apps/mobile/src/app/(main)/index.tsx`
- `apps/mobile/src/app/(main)/receivers/[id].tsx`

Verification:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
npm.cmd --prefix apps/mobile run type-check
```

Backend full suite passed: 20 test files, 62 tests.

`apps/backend/dist` was removed after build verification to keep the working tree clean.

Fourth completed slice - 2026-04-27:

- Added receiver edit/update management:
  - `PATCH /receivers/:receiverId`
  - verifies Supabase bearer token
  - syncs sender profile through `UsersService`
  - scopes update by `userId + receiverId + deletedAt: null`
  - missing/not-owned receivers return `404`
  - updates editable receiver profile, channel, and schedule fields
  - does not expose full phone, phone hash, encrypted fields, consent transcripts, or personal notes in responses
- Added audit event:
  - `receiver.updated`
  - metadata includes only non-sensitive fields: country, relationship, primary channel, fallback channel count, and schedule frequency
- Added Prisma repository support:
  - `updateForUserById`
  - uses ownership-scoped `updateMany` with `deletedAt: null` before reloading the receiver detail
- Updated Expo:
  - `updateReceiver(receiverId, input)`
  - receiver detail `Edit` action opens an inline edit form
  - form edits receiver name, relationship, best channel, country, language, timezone, and schedule window
  - saving updates local detail state and closes the edit form
- Verified in Expo web:
  - opened receiver `aae5f5ea-dd86-459f-9b7b-be6b07b2c08c`
  - clicked `Edit`
  - changed name to `Expo Smoke Edited`
  - changed relationship to `Grandparent`
  - changed best channel to `SMS first`
  - changed window to `08:00 - 10:00`
  - clicked `Save`
  - reloaded the page and confirmed updated values persisted

Files changed for this slice:

- `apps/backend/src/modules/receivers/receivers.controller.ts`
- `apps/backend/src/modules/receivers/receivers.controller.spec.ts`
- `apps/backend/src/modules/receivers/receivers.service.ts`
- `apps/backend/src/modules/receivers/receivers.service.spec.ts`
- `apps/backend/src/modules/receivers/receivers.repository.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.spec.ts`
- `apps/backend/src/modules/receivers/receiver-consent.service.spec.ts`
- `apps/backend/src/modules/receivers/receiver-reply.service.spec.ts`
- `apps/mobile/src/services/backendApi.ts`
- `apps/mobile/src/services/index.ts`
- `apps/mobile/src/app/(main)/receivers/[id].tsx`

Verification:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
npm.cmd --prefix apps/mobile run type-check
```

Backend full suite passed: 20 test files, 65 tests.

`apps/backend/dist` was removed after build verification to keep the working tree clean.

Hotfix - 2026-04-27:

- Fixed Expo Web crash:
  - error was `ExpoSecureStore.default.getValueWithKeyAsync is not a function`
  - root cause was Supabase auth storage falling through to native `expo-secure-store` in the web runtime
  - `apps/mobile/src/services/supabase.ts` now treats browser runtime as web storage even when `Platform.OS` is not enough
  - `apps/mobile/src/services/biometric.ts` now returns unavailable/no-op results on web instead of calling native SecureStore or LocalAuthentication
- Verification:
  - `npm.cmd --prefix apps/mobile run type-check` passed
  - reloaded `http://localhost:8081/` in the in-app browser
  - fresh browser error log after reload had `0` SecureStore / `getValueWithKeyAsync` errors

- Receiver cards:
  - pending consent
  - accepted / active
  - declined
  - revoked / opted out
  - paused for abuse review
  - needs attention
- Receiver detail shell:
  - current consent status
  - schedule
  - latest check-in status
  - backup contacts placeholder
  - pause and edit actions are backend-backed
  - remove action is still a placeholder

### 6. Receiver remove soft-delete flow - completed 2026-04-28

Completed receiver management slice:

- Added authenticated backend soft delete:
  - `DELETE /receivers/:receiverId`
  - verifies Supabase bearer token
  - syncs sender profile through `UsersService`
  - scopes delete by `userId + receiverId + deletedAt: null`
  - sets `deletedAt` instead of hard-deleting rows
  - returns `404` when missing, already deleted, or not owned by the sender
- Added audit event:
  - `receiver.deleted`
  - metadata is intentionally empty to avoid raw PII
- Added Prisma repository support:
  - `deleteForUserById`
  - preloads the active receiver before setting `deletedAt`, because normal detail lookup intentionally excludes deleted receivers
  - uses ownership-scoped `updateMany` with `deletedAt: null`
- Updated Expo:
  - `deleteReceiver(receiverId)`
  - receiver detail `Remove` button now shows a confirmation prompt
  - Expo Web uses `window.confirm` for the confirmation prompt because React Native `Alert.alert` did not render a visible prompt in the web smoke test
  - after confirmation, the delete handler calls the backend and navigates back to dashboard
  - pause/edit behavior remains separate

Files changed for this slice:

- `apps/backend/src/modules/receivers/receivers.controller.ts`
- `apps/backend/src/modules/receivers/receivers.controller.spec.ts`
- `apps/backend/src/modules/receivers/receivers.service.ts`
- `apps/backend/src/modules/receivers/receivers.service.spec.ts`
- `apps/backend/src/modules/receivers/receivers.repository.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.ts`
- `apps/backend/src/modules/receivers/prisma-receivers.repository.spec.ts`
- `apps/mobile/src/services/backendApi.ts`
- `apps/mobile/src/services/index.ts`
- `apps/mobile/src/app/(main)/receivers/[id].tsx`
- `docs/PROJECT_HANDOFF.md`

Focused TDD verification:

```powershell
npm.cmd --prefix apps/backend test -- receivers.service.spec.ts receivers.controller.spec.ts prisma-receivers.repository.spec.ts
```

Full verification completed after implementation:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
npm.cmd --prefix apps/mobile run type-check
```

Browser smoke completed with Browser Use and Expo Web:

- Started backend dev server on port `3000`.
- Started Expo Web on port `8081`.
- Opened `http://localhost:8081` in the in-app browser.
- Confirmed authenticated dashboard loaded backend receivers.
- Opened `Expo Smoke Edited` receiver detail at `/receivers/aae5f5ea-dd86-459f-9b7b-be6b07b2c08c`.
- Confirmed receiver detail rendered status, schedule, channels, backup contacts placeholder, and `Pause` / `Edit` / `Remove` actions.
- First smoke showed the web `Remove` click focused the button but did not show a visible React Native `Alert.alert`; fixed by using `window.confirm` on web and `Alert.alert` on native.
- Re-ran Expo Web smoke after reload; clicking `Remove` opened a blocking browser confirmation dialog.
- The destructive confirmation was not accepted, so the receiver was not deleted during this smoke test.

Android emulator smoke completed with Expo Go:

- Started Pixel 7 AVD as `emulator-5554`.
- Installed/launched Expo Go through `npm.cmd --prefix apps/mobile run android -- --port 8082`.
- Loaded the local Android bundle successfully.
- Verified the app reached the unauthenticated welcome screen.
- After manual sign-in, verified the Android app reached the authenticated dashboard.
- The signed-in Android test account had no receivers, so receiver detail/remove could not be smoke-tested on Android without creating a disposable receiver.

`apps/backend/dist` was removed after build verification.

### 7. Backup contacts foundation - completed 2026-04-28

Completed backend slice:

- Added `BackupContactsModule`.
- Added authenticated nested APIs:
  - `GET /receivers/:receiverId/backup-contacts`
  - `POST /receivers/:receiverId/backup-contacts`
- Both endpoints:
  - verify Supabase bearer token
  - sync sender profile through `UsersService`
  - scope access by `userId + receiverId + receiver.deletedAt: null`
  - return `404` when receiver is missing, deleted, or not owned
- Backup contact creation:
  - trims name, phone, relationship, and optional location instructions
  - normalizes phone to E.164 before hashing/encryption
  - encrypts backup contact name, phone, and optional location instructions
  - stores deterministic phone hash for future lookup
  - assigns `priorityOrder` from active contact count
  - limits each receiver to 5 active backup contacts
  - appends `backup_contact.created` audit event with safe metadata only
- Backup contact list response:
  - returns display name, masked phone, relationship, priority order, location-instructions presence, and created timestamp
  - does not expose raw phone, phone hash, encrypted values, or location instructions

Completed Expo slice:

- Added `listBackupContacts(receiverId)`.
- Added `createBackupContact(receiverId, input)`.
- Receiver detail now loads backup contacts alongside receiver detail.
- Replaced the backup-contact placeholder with:
  - existing backup contact list
  - `Add` action when fewer than 5 contacts exist
  - inline add form for name, phone, country, relationship, and location instructions
  - local list update after successful create
- Backup contacts remain app-free; no invite or backup-contact login flow was added.

Files changed for this slice:

- `apps/backend/src/app.module.ts`
- `apps/backend/src/modules/backup-contacts/backup-contacts.controller.ts`
- `apps/backend/src/modules/backup-contacts/backup-contacts.controller.spec.ts`
- `apps/backend/src/modules/backup-contacts/backup-contacts.module.ts`
- `apps/backend/src/modules/backup-contacts/backup-contacts.repository.ts`
- `apps/backend/src/modules/backup-contacts/backup-contacts.service.ts`
- `apps/backend/src/modules/backup-contacts/backup-contacts.service.spec.ts`
- `apps/backend/src/modules/backup-contacts/backup-contacts.tokens.ts`
- `apps/backend/src/modules/backup-contacts/index.ts`
- `apps/backend/src/modules/backup-contacts/prisma-backup-contacts.repository.ts`
- `apps/backend/src/modules/backup-contacts/prisma-backup-contacts.repository.spec.ts`
- `apps/mobile/src/app/(main)/receivers/[id].tsx`
- `apps/mobile/src/services/backendApi.ts`
- `apps/mobile/src/services/index.ts`
- `docs/PROJECT_HANDOFF.md`

Verification:

```powershell
npm.cmd --prefix apps/backend test -- backup-contacts.service.spec.ts backup-contacts.controller.spec.ts prisma-backup-contacts.repository.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Backend full suite passed: 23 test files, 80 tests.

Runtime notes:

- Existing backend dev server restarted through `tsx watch`; logs confirmed:
  - `BackupContactsModule dependencies initialized`
  - `Mapped {/receivers/:receiverId/backup-contacts, GET} route`
  - `Mapped {/receivers/:receiverId/backup-contacts, POST} route`
- `apps/backend/dist` was removed after build verification.
- A fresh Expo Web server on port `8083` loaded the app cleanly, but it was unauthenticated because browser storage is per-port. Receiver-detail backup-contact UI was therefore not browser-smoked in this slice without another login.

### 8. Backup contact management - completed 2026-04-28

Completed backend slice:

- Added authenticated nested management APIs:
  - `PATCH /receivers/:receiverId/backup-contacts/:backupContactId`
  - `DELETE /receivers/:receiverId/backup-contacts/:backupContactId`
- Both endpoints:
  - verify Supabase bearer token
  - sync sender profile through `UsersService`
  - scope access through sender-owned, non-deleted receivers
  - return `404` when the receiver/contact is missing, deleted, or not owned
- Backup contact update:
  - trims name, optional phone, relationship, and optional location instructions
  - encrypts updated name and location instructions
  - normalizes/encrypts/hashes a new phone only when one is supplied
  - preserves the existing phone when the edit request omits phone
  - clears stored location instructions when the field is blank
  - appends `backup_contact.updated` audit events with safe metadata only
- Backup contact delete:
  - soft deletes by setting `deletedAt`
  - does not hard-delete rows or expose raw PII
  - appends `backup_contact.deleted` audit events with safe metadata only

Completed Expo slice:

- Added `updateBackupContact(receiverId, backupContactId, input)`.
- Added `deleteBackupContact(receiverId, backupContactId)`.
- Receiver detail backup-contact list now includes `Edit` and `Remove` actions.
- Edit opens the inline backup-contact form prefilled with display name and relationship.
- Because raw phone is not returned by the backend, edit leaves phone blank and preserves the current stored phone unless the sender enters a replacement.
- Remove uses the same confirmation approach as receiver remove: `window.confirm` on Expo Web, `Alert.alert` on native.
- Local backup-contact state updates after successful edit/remove.

Files changed for this slice:

- `apps/backend/src/modules/backup-contacts/backup-contacts.controller.ts`
- `apps/backend/src/modules/backup-contacts/backup-contacts.controller.spec.ts`
- `apps/backend/src/modules/backup-contacts/backup-contacts.repository.ts`
- `apps/backend/src/modules/backup-contacts/backup-contacts.service.ts`
- `apps/backend/src/modules/backup-contacts/backup-contacts.service.spec.ts`
- `apps/backend/src/modules/backup-contacts/prisma-backup-contacts.repository.ts`
- `apps/backend/src/modules/backup-contacts/prisma-backup-contacts.repository.spec.ts`
- `apps/mobile/src/app/(main)/receivers/[id].tsx`
- `apps/mobile/src/services/backendApi.ts`
- `apps/mobile/src/services/index.ts`
- `docs/PROJECT_HANDOFF.md`

Verification:

```powershell
npm.cmd --prefix apps/backend test -- backup-contacts.service.spec.ts backup-contacts.controller.spec.ts prisma-backup-contacts.repository.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Backend full suite passed: 23 test files, 87 tests.

Runtime notes:

- Browser/Android smoke was deferred immediately after implementation because the user asked to test both together in the next step.
- `apps/backend/dist` was removed after build verification.

### 9. Backup contact smoke test pass - partial 2026-04-28

Completed during smoke setup:

- Fixed local backend CORS for Expo dev ports:
  - `apps/backend/src/main.ts`
  - previous CORS allowed only `http://localhost:8081` and `http://127.0.0.1:8081`
  - Expo Web was running on `http://localhost:8083`, so browser requests failed with `TypeError: Failed to fetch`
  - CORS now allows local Expo origins matching `http://localhost:80xx` and `http://127.0.0.1:80xx`
- Fixed Android emulator backend URL resolution:
  - `apps/mobile/src/services/backendApi.ts`
  - Expo Web can use `http://localhost:3000`
  - Android emulator must use `http://10.0.2.2:3000` to reach the host machine
  - `backendRequest` now rewrites localhost/127.0.0.1 backend URLs to `10.0.2.2` when `Platform.OS === 'android'`

Browser Use smoke against `http://localhost:8083`:

- Logged in with the test account provided by the user.
- Created disposable receiver `Backup Smoke Receiver`.
- Reloaded dashboard and confirmed receiver appeared.
- Opened receiver detail at `/receivers/df1e4b98-61c4-4472-a940-dd30a55ba16b`.
- Added backup contact:
  - name: `Backup Smoke Contact`
  - phone masked as `*******0199`
  - relationship: `Neighbor`
  - location instructions present
- Edited backup contact:
  - name changed to `Backup Smoke Contact Edited`
  - relationship changed to `Building Manager`
  - phone left blank in edit form, confirming existing phone was preserved
  - location instructions updated
- Reloaded receiver detail and confirmed edited backup contact persisted as:
  - `Backup Smoke Contact Edited`
  - `Building Manager - *******0199`
  - `Instructions saved`
- Destructive backup-contact removal was not executed because delete actions require action-time confirmation.

Android emulator smoke:

- Booted `Pixel_7` AVD as `emulator-5554`.
- Launched Expo Go through `exp://10.0.2.2:8082/--/`.
- Confirmed the app loads on Android.
- Signed in manually through the native login screen after correcting an adb text-entry issue where the password initially became `<mistyped password, redacted>`.
- Android then loaded the app shell and Add Receiver screen.
- Direct navigation to the receiver detail route loaded the screen, but receiver API calls reported `You need to sign in again`.
- Superseded by section 10: native Supabase session persistence was fixed on 2026-04-29 and Android receiver-detail backup-contact create/edit smoke passed after the fix.

Verification after smoke fixes:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Backend full suite passed: 23 test files, 87 tests.

`apps/backend/dist` was removed after build verification.

Files changed during smoke:

- `apps/backend/src/main.ts`
- `apps/mobile/src/services/backendApi.ts`
- `docs/PROJECT_HANDOFF.md`

### 10. Android auth/session persistence fix - 2026-04-29

Completed:

- Fixed native Supabase session persistence on Android.
- Root cause: `apps/mobile/src/services/supabase.ts` treated `typeof window !== 'undefined'` as a web runtime signal. React Native can expose `window`, so Expo Go on Android was routed to the web `localStorage` path, which was unavailable and caused `getSession()` to return no token for backend API calls.
- Added `apps/mobile/src/services/auth-storage.ts` to split storage responsibilities:
  - Supabase sessions use AsyncStorage on native.
  - OAuth state uses SecureStore on native.
  - Web still uses browser `localStorage`.
- Added `apps/mobile/src/services/auth-storage.test.ts` to cover Android with `hasWindow: true`, native OAuth state, and web session storage.

Android emulator smoke on `emulator-5554`:

- Logged in through Expo Go with the user-provided test account.
- Dashboard loaded receivers from the backend, proving authenticated backend requests had a Supabase access token.
- Receiver detail for `Backup Smoke Receiver` loaded backup contacts.
- Created Android smoke backup contact:
  - masked phone displayed as `*******4198`
  - instructions state displayed
- Edited that Android smoke backup contact:
  - updated name displayed as `AndroidSmokeEditedct`
  - updated relationship displayed as `Caretakerr - *******4198`
  - phone was left blank in the edit form and remained preserved
- The trailing characters in the displayed smoke labels came from adb text input, not from application logic.

Runtime note:

- Expo Go still occasionally shows `Unable to activate keep awake`; this appears non-blocking and unrelated to auth/session persistence.

### 11. HELP response escalation slice - 2026-04-29

Completed:

- Added design and implementation plan:
  - `docs/superpowers/specs/2026-04-29-help-escalation-design.md`
  - `docs/superpowers/plans/2026-04-29-help-escalation.md`
- Added `apps/backend/src/modules/escalations`:
  - `EscalationsService`
  - `PrismaEscalationsRepository`
  - `EscalationsModule`
  - repository token and interfaces
- Wired `ReceiverReplyService` so receiver HELP responses trigger escalation after the open check-in is marked `RESPONDED_HELP`.
- Current HELP escalation behavior:
  - loads active backup contacts for the receiver ordered by `priorityOrder`, then `createdAt`
  - sends SMS alerts through `ChannelRouterService` with template `backup_contact_help_alert`
  - decrypts backup-contact phone only for provider delivery
  - creates one `escalation_events` row per attempted backup-contact alert
  - marks the check-in `ESCALATED` if at least one alert succeeds
  - records PII-safe audit entries with IDs/status/channel only
  - audits `escalation.no_backup_contacts` without marking the check-in escalated when no active backup contacts exist
  - records provider failures as `EscalationResult.ERROR` and continues to the next contact

Focused verification passed:

```powershell
npm.cmd --prefix apps/backend test -- escalations.service.spec.ts prisma-escalations.repository.spec.ts receiver-reply.service.spec.ts
npm.cmd --prefix apps/backend run type-check
```

Focused suite passed: 3 files, 12 tests.

Full backend verification passed before commit:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Backend full suite passed: 25 test files, 93 tests.

### 12. Next Planned Slice

### 12. Missed check-in escalation slice - 2026-04-29

Completed:

- Added design and implementation plan:
  - `docs/superpowers/specs/2026-04-29-missed-check-in-escalation-design.md`
  - `docs/superpowers/plans/2026-04-29-missed-check-in-escalation.md`
- Extended `EscalationsService` with `escalateMissedCheckIn`.
- Missed check-in escalation uses the same ordered backup-contact alert loop as HELP escalation, with:
  - template `backup_contact_missed_checkin_alert`
  - audit metadata `escalationReason: missed_check_in`
  - sent timestamp and response window in audit metadata
  - no raw names, phones, or message bodies in audit metadata
- Added `CheckInsRepository.findOverdueSentCheckIns`.
- Prisma overdue query selects only `SENT` check-ins with `sentAt <= overdueBefore`, ordered by oldest `sentAt`.
- Added `CheckInsService.escalateOverdueCheckIns`.
- Approved MVP response window is 30 minutes after `sentAt`.
- `CheckInsService.escalateOverdueCheckIns()` delegates each overdue `SENT` check-in to `EscalationsService.escalateMissedCheckIn`.

Focused verification passed:

```powershell
npm.cmd --prefix apps/backend test -- escalations.service.spec.ts prisma-check-ins.repository.spec.ts check-ins.service.spec.ts receiver-reply.service.spec.ts
npm.cmd --prefix apps/backend run type-check
```

Focused suite passed: 4 files, 17 tests.

Full backend verification passed before commit:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Backend full suite passed: 25 test files, 96 tests.

### 13. Next Planned Slice

### 13. Operations check-in trigger slice - 2026-04-29

Completed:

- Added design and implementation plan:
  - `docs/superpowers/specs/2026-04-29-operations-check-in-trigger-design.md`
  - `docs/superpowers/plans/2026-04-29-operations-check-in-trigger.md`
- Added `OperationsModule`.
- Added protected backend endpoint:
  - `POST /operations/check-ins/run`
  - header originally used `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
  - superseded on 2026-04-30 by dedicated `OPERATIONS_CRON_SECRET` scheduler auth
- Endpoint runs:
  - `CheckInsService.sendDueCheckIns()`
  - `CheckInsService.escalateOverdueCheckIns()`
- Endpoint returns aggregate counts only:
  - due check-ins: `created`, `sent`, `skipped`
  - overdue escalations: `checked`, `escalated`, `skipped`, `failed`
- Endpoint does not return receiver IDs, check-in IDs, provider IDs, names, phones, transcripts, or message bodies.

Focused verification passed:

```powershell
npm.cmd --prefix apps/backend test -- operations.controller.spec.ts
npm.cmd --prefix apps/backend run type-check
```

Focused suite passed: 1 file, 2 tests.

Full backend verification passed before commit:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Backend full suite passed: 26 test files, 98 tests.

### 14. Operations trigger local smoke - completed 2026-04-30

Completed:

- Started the backend dev server locally on port `3000`.
- Confirmed `CHANNEL_PROVIDER_MODE="fake"` in local backend env.
- Called the protected operations endpoint with the local service-role bearer token:
  - `POST http://localhost:3000/operations/check-ins/run`
- Endpoint returned:
  - `ok: true`
  - due check-ins: `created: 2`, `sent: 2`, `skipped: 0`
  - overdue escalations: `checked: 0`, `escalated: 0`, `skipped: 0`, `failed: 0`
- No raw receiver IDs, names, phone numbers, transcripts, provider IDs, or message bodies were returned by the endpoint.

Baseline verification before smoke:

```powershell
git status --short --branch
npm run verify
```

`npm run verify` runs the same gates as CI (prisma generate, lint, typecheck, prisma validate, build, all tests, workflow/secret/dependency scans). For a quicker loop use `npm test` or `npm.cmd --prefix apps/backend test -- <spec>`.

Backend baseline passed: 26 test files, 98 tests.

### 15. Hosted operations scheduler - completed 2026-04-30

Completed:

- Added design and implementation plan:
  - `docs/superpowers/specs/2026-04-30-operations-scheduler-design.md`
  - `docs/superpowers/plans/2026-04-30-operations-scheduler.md`
- Added a reusable operations runner:
  - `apps/backend/src/modules/operations/operations-runner.ts`
  - posts to the configured `POST /operations/check-ins/run` endpoint
  - sends `Authorization: Bearer <OPERATIONS_CRON_SECRET>`
  - validates required env-driven configuration
  - reconstructs aggregate output so unexpected response details are not logged
  - does not include response bodies in HTTP failure messages
- Added CLI wrapper:
  - `apps/backend/scripts/run-operations-check-ins.ts`
  - reads `OPERATIONS_CHECK_INS_RUN_URL`
  - reads `OPERATIONS_CRON_SECRET`
  - logs only the aggregate endpoint response
- Added backend package script:
  - `npm --prefix apps/backend run operations:check-ins`
- Added GitHub Actions scheduler:
  - `.github/workflows/operations-check-ins.yml`
  - runs every 10 minutes
  - supports manual `workflow_dispatch`
  - uses GitHub Secrets for `OPERATIONS_CHECK_INS_RUN_URL` and `OPERATIONS_CRON_SECRET`
  - does not require the Supabase service-role key in GitHub Actions
  - skips cleanly with a GitHub Actions notice when the scheduler secrets are not configured yet

Required GitHub repository secrets before enabling hosted runs:

- `OPERATIONS_CHECK_INS_RUN_URL`: full deployed endpoint URL, e.g. `https://api.example.com/operations/check-ins/run`
- `OPERATIONS_CRON_SECRET`: random high-entropy token that also exists in the backend runtime environment

Focused verification:

```powershell
npm.cmd --prefix apps/backend test -- operations-runner.spec.ts
```

Focused suite passed: 1 file, 4 tests.

Scheduler auth hardening update - 2026-04-30:

- Replaced scheduler authentication with a dedicated `OPERATIONS_CRON_SECRET`.
- The backend operations endpoint now validates `Authorization: Bearer <OPERATIONS_CRON_SECRET>` using timing-safe comparison.
- The GitHub Actions workflow now reads:
  - `OPERATIONS_CHECK_INS_RUN_URL`
  - `OPERATIONS_CRON_SECRET`
- The GitHub Actions workflow no longer needs or receives `SUPABASE_SERVICE_ROLE_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` remains a backend-only secret for Supabase/database operations.
- Updated `apps/backend/.env.example` with `OPERATIONS_CRON_SECRET`.

Focused verification:

```powershell
npm.cmd --prefix apps/backend test -- operations.controller.spec.ts operations-runner.spec.ts app-config.service.spec.ts
```

Focused suite passed: 3 files, 8 tests.

### 16. Missed escalation terminal outcomes - completed 2026-04-30

Completed:

- Added design and implementation plan:
  - `docs/superpowers/specs/2026-04-30-missed-escalation-terminal-outcomes-design.md`
  - `docs/superpowers/plans/2026-04-30-missed-escalation-terminal-outcomes.md`
- Fixed missed-check-in escalation terminal outcomes so the 10-minute operations scheduler does not repeatedly process the same overdue `SENT` check-in.
- Missed check-in with no active backup contacts now:
  - audits `escalation.no_backup_contacts`
  - marks the check-in `SKIPPED`
  - audits `check_in.escalation_skipped`
- Missed check-in where every backup alert fails now:
  - creates failed `escalation_events`
  - marks the check-in `FAILED`
  - audits `check_in.escalation_failed`
- Missed check-in with at least one successful backup alert keeps existing `ESCALATED` behavior.
- Explicit receiver HELP response behavior is unchanged:
  - no backup contacts still leaves the check-in as `RESPONDED_HELP`
  - all provider failures still leave the check-in as `RESPONDED_HELP`
- `CheckInsService.escalateOverdueCheckIns()` now counts terminal `FAILED` outcomes as `failed`, not `skipped`.
- Audit metadata remains PII-safe: IDs, statuses, counts, channels, and operational reasons only.

Focused verification:

```powershell
npm.cmd --prefix apps/backend test -- check-ins.service.spec.ts escalations.service.spec.ts prisma-escalations.repository.spec.ts
```

Focused suite passed: 3 files, 14 tests.

### 17. Cron-secret operations smoke - completed 2026-04-30

Completed local smoke against the running backend on port `3000`:

- Confirmed local backend env has:
  - `CHANNEL_PROVIDER_MODE="fake"`
  - `OPERATIONS_CRON_SECRET`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Called `POST http://localhost:3000/operations/check-ins/run` with `Authorization: Bearer <OPERATIONS_CRON_SECRET>`.
- Endpoint returned aggregate counts only:
  - `ok: true`
  - due check-ins: `created: 0`, `sent: 0`, `skipped: 0`
  - overdue escalations: `checked: 2`, `escalated: 0`, `skipped: 2`, `failed: 0`
- Called the same endpoint with `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
- Service-role bearer was rejected with HTTP `401`, confirming the scheduler path no longer accepts the Supabase service-role key.
- No raw receiver IDs, names, phone numbers, provider IDs, transcripts, or message bodies were returned by the endpoint.

Focused verification before smoke:

```powershell
npm.cmd --prefix apps/backend test -- operations.controller.spec.ts operations-runner.spec.ts app-config.service.spec.ts
```

Focused suite passed: 3 files, 8 tests.

### 18. Sender-facing escalation status labels - completed 2026-04-30

Completed Expo/mobile visibility slice:

- Added shared receiver status helper:
  - `apps/mobile/src/utils/receiverStatus.ts`
  - `apps/mobile/src/utils/receiverStatus.spec.ts`
- Dashboard and receiver detail now share the same status mapping.
- Escalation outcomes now render clearly for senders:
  - `ESCALATED` -> `Backup alerted` with error tone
  - `FAILED` -> `Escalation failed` with error tone
  - `SKIPPED` -> `No backup available` with warning tone
- Existing mappings are preserved:
  - `RESPONDED_OK` -> `OK`
  - `RESPONDED_HELP` -> `Needs help`
  - `SENT` -> `Awaiting reply`
  - consent pending/declined/revoked and paused states still show their previous sender-facing labels.
- Backend API contract did not change.

Focused verification:

```powershell
npx vitest run apps/mobile/src/utils/receiverStatus.spec.ts
npm.cmd --prefix apps/mobile run type-check
```

Focused suite passed: 1 file, 4 tests. Mobile type-check passed.

### 19. Sender check-in resolution - completed 2026-04-30

Completed sender-driven incident closure slice:

- Added design and implementation plan:
  - `docs/superpowers/specs/2026-04-30-check-in-resolution-design.md`
  - `docs/superpowers/plans/2026-04-30-check-in-resolution.md`
- Added authenticated backend endpoint:
  - `PATCH /receivers/:receiverId/check-ins/:checkInId/resolve`
  - verifies sender Supabase bearer token
  - scopes update through sender-owned, non-deleted receiver
  - only resolves actionable latest check-in states: `RESPONDED_HELP`, `ESCALATED`, `FAILED`, `SKIPPED`
  - sets `status = RESOLVED`, `resolvedAt`, and `resolutionByUserId`
  - returns updated receiver detail
- Added audit event:
  - `check_in.resolved`
  - metadata includes only `receiverId`; no raw PII, message bodies, transcripts, or notes
- Added Expo API method:
  - `resolveReceiverCheckIn(receiverId, checkInId)`
- Receiver detail now shows latest check-in `Resolved` timestamp and a `Mark resolved` action for actionable states.
- Mobile status helper now maps `RESOLVED` -> `Resolved`.
- Free-text resolution notes were intentionally left out to avoid adding a new PII surface in this slice.

Focused verification:

```powershell
npm.cmd --prefix apps/backend test -- receivers.service.spec.ts receivers.controller.spec.ts prisma-receivers.repository.spec.ts
npx vitest run apps/mobile/src/utils/receiverStatus.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
```

Focused backend receiver tests passed: 3 files, 29 tests. Mobile status helper passed: 1 file, 5 tests.

### 20. Sender resolution API smoke - completed 2026-04-30

Completed local API smoke against the running backend on port `3000`:

- Signed in with the existing Supabase test account provided in chat.
- Created disposable synthetic receivers named `Resolution Smoke ...`.
- Granted receiver consent through `POST /receiver-replies/fake`.
- Triggered check-in creation/sending through `POST /operations/check-ins/run` with `OPERATIONS_CRON_SECRET`.
- Submitted a fake `HELP` receiver reply through `POST /receiver-replies/fake`.
- Confirmed receiver detail returned an actionable latest check-in before resolution.
- Called `PATCH /receivers/:receiverId/check-ins/:checkInId/resolve`.
- Confirmed the latest check-in returned as:
  - `status = RESOLVED`
  - `resolvedAt` present
  - `resolutionByUserId` present in the database
- Confirmed the latest `check_in.resolved` audit row has metadata keys:
  - `receiverId`
- No raw names, phone numbers, credentials, tokens, transcripts, or message bodies were written to source-controlled docs.
- Disposable smoke receivers/check-ins were left in the environment; no destructive cleanup was performed.

### 21. Smoke data cleanup - completed 2026-04-30

Completed after explicit action-time approval:

- Soft-deleted 3 disposable smoke receivers:
  - 2 `Resolution Smoke ...` receivers from the sender resolution smoke
  - `Backup Smoke Receiver`
- Soft-deleted 2 active backup contacts under `Backup Smoke Receiver`.
- Preserved historical rows:
  - check-ins were not deleted
  - audit logs were not deleted
  - escalation rows were not deleted
- Verification confirmed:
  - all 3 smoke receivers have `deletedAt`
  - active backup contacts for those receivers are `0`
  - check-in and audit-log counts remain present for historical traceability

### 22. Operations check-in visibility - completed 2026-04-30

Completed protected read-only operations visibility slice:

- Added backend endpoint:
  - `GET /operations/check-ins/summary`
  - protected by `Authorization: Bearer <OPERATIONS_CRON_SECRET>`
  - reuses timing-safe operations bearer comparison
- Added operations visibility service and Prisma repository:
  - counts check-ins by status over the default 24-hour window
  - excludes soft-deleted receivers from counts and recent rows
  - returns the 25 newest operational check-ins with statuses:
    - `RESPONDED_HELP`
    - `ESCALATED`
    - `FAILED`
    - `SKIPPED`
    - `RESOLVED`
  - includes only operational identifiers/timestamps/counts:
    - `checkInId`
    - `receiverId`
    - `status`
    - `scheduledAt`
    - optional `sentAt`, `respondedAt`, `resolvedAt`
    - `escalationAttemptCount`
    - `successfulEscalationCount`
- Response intentionally excludes raw names, phone numbers, transcripts, message bodies, encrypted payloads, and provider payloads.
- Added design and implementation plan:
  - `docs/superpowers/specs/2026-04-30-operations-visibility-design.md`
  - `docs/superpowers/plans/2026-04-30-operations-visibility.md`

Focused verification:

```powershell
npm.cmd --prefix apps/backend test -- operations-visibility.service.spec.ts prisma-operations-visibility.repository.spec.ts operations.controller.spec.ts
npm.cmd --prefix apps/backend run type-check
```

Full verification:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Local HTTP smoke against `http://localhost:3000/operations/check-ins/summary` passed:

- returned `ok: true`
- returned `windowHours: 24`
- returned recent operational rows
- response did not contain `phone`, `name`, or `transcript`

### 23. Admin auth foundation - completed 2026-04-30

Completed backend admin authorization foundation:

- Added design and implementation plan:
  - `docs/superpowers/specs/2026-04-30-admin-auth-foundation-design.md`
  - `docs/superpowers/plans/2026-04-30-admin-auth-foundation.md`
- Added admin allowlist repository and service:
  - `AdminAuthService`
  - `PrismaAdminUsersRepository`
  - `AdminUsersRepository`
  - `ADMIN_USERS_REPOSITORY`
- Admin auth behavior:
  - verifies Supabase bearer tokens through existing `SupabaseAuthService`
  - looks up `admin_users.authProviderId`
  - requires `active = true`
  - supports role allowlists
  - does not auto-create admin rows from sender auth
  - does not select or return admin email, encrypted email, or email hash
- Added endpoint:
  - `GET /auth/admin/me`
  - returns only `admin.id` and `admin.role`
- Updated operations auth split:
  - `GET /operations/check-ins/summary` now requires active admin Supabase bearer auth
  - `POST /operations/check-ins/run` remains protected by `OPERATIONS_CRON_SECRET`
  - this keeps the scheduler secret out of future client/admin UI surfaces

Focused verification:

```powershell
npm.cmd --prefix apps/backend test -- admin-auth.service.spec.ts prisma-admin-users.repository.spec.ts auth.controller.spec.ts operations.controller.spec.ts
npm.cmd --prefix apps/backend run type-check
```

Full verification:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Local HTTP auth split smoke against the running backend on port `3000`:

- `GET /operations/check-ins/summary` with `OPERATIONS_CRON_SECRET` returned `401`
- `POST /operations/check-ins/run` with `OPERATIONS_CRON_SECRET` returned `200`

### 24. Supabase Security Advisor RLS hardening - completed 2026-04-30

Security Advisor reported `rls_disabled_in_public` errors for internal public-schema tables:

- `public.admin_users`
- `public.channel_templates`
- `public.idempotency_keys`

Applied the approved hosted-project hardening:

```sql
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
```

No policies were added for these tables. With RLS enabled and no policies, `anon` and normal authenticated Supabase clients are denied by default through PostgREST, while backend/service-role/database paths remain available for internal use.

Verification confirmed:

- all three tables have `relrowsecurity = true`
- `pg_policies` has `0` policies for those three tables

Repo follow-up:

- Added `apps/backend/prisma/20260430_internal_tables_rls.sql`
- Updated `apps/backend/prisma/supabase_setup.sql` so fresh rebuilds also enable RLS on these internal tables

### 25. Supabase Security Advisor WARN fixes - completed 2026-04-30

Security Advisor also reported WARN findings:

- `function_search_path_mutable` for `public.prevent_audit_log_modification`
- `extension_in_public` for `pg_trgm`
- `auth_leaked_password_protection` disabled

Applied the approved hosted-project database fixes:

```sql
ALTER FUNCTION public.prevent_audit_log_modification()
SET search_path = public, pg_temp;

CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
```

Verification confirmed:

- `prevent_audit_log_modification` has `proconfig = search_path=public, pg_temp`
- `pg_trgm` now lives in the `extensions` schema
- no dependent `pg_trgm` objects were found before the extension move

Repo follow-up:

- Added `apps/backend/prisma/20260430_security_advisor_warn_fixes.sql`
- Updated `apps/backend/prisma/supabase_setup.sql`
- Updated `apps/backend/prisma/reset_public_schema_for_nearby.sql`

Remaining non-database dashboard setting:

- `auth_leaked_password_protection` must be enabled in Supabase Dashboard under Authentication security settings.
- This is recommended before inviting beta/production users.

Security Advisor INFO notes:

- `rls_enabled_no_policy` is expected for internal deny-by-default tables such as `admin_users`, `channel_templates`, and `idempotency_keys`.
- Other no-policy tables remain denied to direct Supabase clients unless intentionally exposed later through explicit scoped read policies.
- Do not add broad policies just to silence INFO findings; each table should get a policy only when a product flow requires direct client access.

### 26. Admin operations dashboard UI - completed 2026-04-30

Completed read-only Expo web/admin operations dashboard:

- Added route:
  - `/admin-operations`
  - file: `apps/mobile/src/app/(main)/admin-operations.tsx`
- Added typed backend API methods:
  - `getAdminMe()`
  - `getOperationsCheckInSummary()`
- Added operations formatting helpers:
  - `apps/mobile/src/utils/adminOperations.ts`
  - `apps/mobile/src/utils/adminOperations.spec.ts`
- Dashboard behavior:
  - uses existing Supabase app session through `backendApi`
  - calls `GET /auth/admin/me`
  - calls `GET /operations/check-ins/summary`
  - shows admin role, 24-hour status counts, and recent operational check-ins
  - shows operational identifiers/timestamps/escalation counts only
  - includes a refresh action
  - shows access-denied/error state if the signed-in user is not an active admin
- Security boundary:
  - does not expose `OPERATIONS_CRON_SECRET`
  - does not show names, phone numbers, transcripts, message bodies, encrypted payloads, or provider payloads
  - read-only; no mutation actions
- Added design and implementation plan:
  - `docs/superpowers/specs/2026-04-30-admin-operations-dashboard-design.md`
  - `docs/superpowers/plans/2026-04-30-admin-operations-dashboard.md`

Verification:

```powershell
npx vitest run apps/mobile/src/utils/adminOperations.spec.ts
npm.cmd --prefix apps/mobile run type-check
```

Expo web smoke on `http://localhost:8084/admin-operations` passed after signing into the Nearby app as the provisioned `SUPER_ADMIN`:

- displayed `SUPER ADMIN`
- displayed `24 hours`
- displayed status counts
- displayed recent operational check-ins
- no names, phone numbers, or transcripts appeared in the DOM snapshot

Admin operations detail view was added on 2026-04-30:

- backend endpoint: `GET /operations/check-ins/:checkInId`
- mobile route: `/admin-operations/:checkInId`
- protected by the same active admin bearer auth as the summary endpoint
- displays status, timeline, check-in ID, receiver ID, channel, escalation counts, and escalation delivery timestamps
- intentionally excludes receiver names, phone numbers, personal notes, transcripts, message bodies, resolution notes, and provider error details

Verification:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/operations/operations-visibility.service.spec.ts src/modules/operations/prisma-operations-visibility.repository.spec.ts src/modules/operations/operations.controller.spec.ts
npm.cmd --prefix apps/backend run type-check
npx vitest run apps/mobile/src/utils/adminOperations.spec.ts
npm.cmd --prefix apps/mobile run type-check
```

In-app browser smoke passed on `http://localhost:8084/admin-operations/7e207653-d8b8-444e-9161-461e655c3c2c`:

- displayed `Check-in Detail`
- displayed timeline and escalation sections
- displayed check-in and receiver UUIDs only
- no names, phone numbers, transcripts, or message body content appeared in the DOM snapshot

### 26b. Admin abuse review queue - completed 2026-04-30

Completed admin abuse monitoring slice:

- Added backend admin abuse module:
  - `AdminAbuseController`
  - `AdminAbuseService`
  - `PrismaAdminAbuseRepository`
  - `AdminAbuseModule`
- Added active-admin protected endpoints:
  - `GET /admin/abuse-reports`
  - `GET /admin/abuse-reports/:abuseReportId`
  - `PATCH /admin/abuse-reports/:abuseReportId/review-safe`
  - `PATCH /admin/abuse-reports/:abuseReportId/review-action-taken`
- Listing/detail responses expose only operational review fields:
  - abuse report id
  - receiver id
  - reported timestamp
  - review status
  - reviewer admin id
  - reviewed timestamp
  - whether encrypted report content exists
- Responses intentionally do not expose raw receiver names, phone numbers, report bodies, transcripts, encrypted content, hashes, or provider payloads.
- Review mutations require `SUPER_ADMIN` or `OPERATOR`.
- Review mutations append PII-safe admin audit events:
  - `reviewed_safe`
  - `reviewed_action_taken`
- Added Expo admin route:
  - `/admin-abuse-reports`
  - shows admin role, pending report count, read-only/review access state, and pending abuse report rows
  - provides `Mark safe` and `Action taken` actions for review-capable admins
- Added sidebar and stack route wiring for the abuse queue.

Files changed for this slice:

- `apps/backend/src/app.module.ts`
- `apps/backend/src/modules/admin-abuse/admin-abuse.controller.ts`
- `apps/backend/src/modules/admin-abuse/admin-abuse.controller.spec.ts`
- `apps/backend/src/modules/admin-abuse/admin-abuse.module.ts`
- `apps/backend/src/modules/admin-abuse/admin-abuse.repository.ts`
- `apps/backend/src/modules/admin-abuse/admin-abuse.service.ts`
- `apps/backend/src/modules/admin-abuse/admin-abuse.service.spec.ts`
- `apps/backend/src/modules/admin-abuse/admin-abuse.tokens.ts`
- `apps/backend/src/modules/admin-abuse/prisma-admin-abuse.repository.ts`
- `apps/backend/src/modules/admin-abuse/prisma-admin-abuse.repository.spec.ts`
- `apps/mobile/src/app/(main)/admin-abuse-reports.tsx`
- `apps/mobile/src/app/(main)/_layout.tsx`
- `apps/mobile/src/components/layout/Sidebar.tsx`
- `apps/mobile/src/services/backendApi.ts`
- `apps/mobile/src/services/index.ts`

### 27. Sender escalation actions - completed 2026-04-30

Completed sender-facing escalation decision actions from receiver detail:

- Added authenticated backend endpoints:
  - `PATCH /receivers/:receiverId/check-ins/:checkInId/alert-backup`
  - `PATCH /receivers/:receiverId/check-ins/:checkInId/try-later`
- Both endpoints:
  - verify the sender Supabase bearer token
  - scope the action through sender-owned, non-deleted receiver detail
  - require the target check-in to be the latest check-in for that receiver
  - reject non-actionable states
- `alert-backup`:
  - allowed for latest `RESPONDED_HELP`, `FAILED`, and `SKIPPED` check-ins
  - writes `check_in.backup_alert_requested` as a user audit event
  - reuses `EscalationsService.escalateSenderRequestedBackup`
  - sends `backup_contact_sender_requested_alert` through the existing backup escalation delivery path
  - audit metadata remains limited to IDs, previous status, counts, channels, and operational reason
- `try-later`:
  - allowed for latest `SENT`, `RESPONDED_HELP`, `FAILED`, and `SKIPPED` check-ins
  - writes `check_in.try_later_requested`
  - does not send provider messages in this slice
- Receiver detail UI now shows contextual actions:
  - `Alert backup contacts`
  - `Try again later`
  - `Mark resolved`

Verification:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.service.spec.ts src/modules/receivers/receivers.controller.spec.ts src/modules/escalations/escalations.service.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
```

In-app browser smoke passed on `http://localhost:8084/receivers/c2852756-939f-4c9f-9f01-5580fcc7d15c`:

- displayed latest check-in status `Skipped`
- displayed `Alert backup contacts`
- displayed `Try again later`
- displayed `Mark resolved`
- no transcripts or message body content appeared in the DOM snapshot

### 28. Backup contact DONE reply handling - completed 2026-04-30

Completed backend closure path for backup-contact replies:

- Existing fake inbound endpoint now supports backup contacts:
  - `POST /receiver-replies/fake`
  - first matches active receivers by normalized phone hash
  - if no receiver matches, matches active backup contacts by normalized phone hash
- Backup contact reply behavior:
  - accepts `DONE`, `CHECKED`, and `RESOLVED` as closure confirmations
  - finds the latest actionable check-in for the backup contact's receiver
  - actionable statuses are:
    - `RESPONDED_HELP`
    - `ESCALATED`
    - `FAILED`
    - `SKIPPED`
  - marks the check-in `RESOLVED` and sets `resolvedAt`
  - returns `backupContactId`, `receiverId`, `checkInId`, and resolved status from the fake endpoint
- Audit event:
  - `check_in.resolved_by_backup`
  - metadata includes only `receiverId`, `backupContactId`, channel, normalized reply, and provider message id
  - no raw backup names, receiver names, phone numbers, transcripts, notes, or message bodies are stored in audit metadata
- Repository updates:
  - `BackupContactsRepository.findActiveByPhoneHash`
  - `CheckInsRepository.findLatestActionableForReceiver`
  - `CheckInsRepository.markResolvedByBackupContact`
- This completes the core BRD closure loop where a backup contact can confirm they checked on the receiver.

Verification:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/receivers/receiver-reply.service.spec.ts src/modules/check-ins/prisma-check-ins.repository.spec.ts src/modules/backup-contacts/prisma-backup-contacts.repository.spec.ts src/modules/check-ins/check-ins.service.spec.ts src/modules/backup-contacts/backup-contacts.service.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
```

Full backend suite passed: 34 files, 149 tests.

### 29. Provider webhook adapter controllers - completed 2026-05-01

Completed protected inbound webhook adapter slice:

- Added backend provider webhook module:
  - `ProviderWebhooksModule`
  - `ProviderWebhooksController`
- Added protected endpoints:
  - `POST /provider-webhooks/whatsapp`
  - `POST /provider-webhooks/sms`
  - `POST /provider-webhooks/twilio/messaging`
  - `POST /provider-webhooks/twilio/voice`
- Both endpoints require:
  - `x-nearby-webhook-secret: <CHANNEL_WEBHOOK_SECRET>`
- WhatsApp endpoint:
  - accepts Meta-shaped `entry[].changes[].value.messages[]` payloads
  - processes only text messages with a sender and text body
  - normalizes sender phone numbers into international format when needed
  - maps payloads into the existing normalized reply service with `Channel.WHATSAPP`
  - ignores non-text messages without echoing payload details
- SMS endpoint:
  - accepts generic lowercase fields (`from`, `body`, `messageId`, `receivedAt`)
  - accepts Twilio-style fields (`From`, `Body`, `MessageSid`)
  - maps payloads into the existing normalized reply service with `Channel.SMS`
- Twilio messaging endpoint:
  - validates `X-Twilio-Signature`
  - uses `TWILIO_AUTH_TOKEN` and `PUBLIC_API_BASE_URL`
  - accepts Twilio inbound SMS and WhatsApp message webhooks
  - maps `From=whatsapp:+E164` to `Channel.WHATSAPP`
  - maps plain `From=+E164` to `Channel.SMS`
- Twilio voice endpoint:
  - validates `X-Twilio-Signature`
  - maps `Digits` first, then `SpeechResult`, to `Channel.VOICE`
  - uses `CallSid` as the provider message id when present
- Configured outbound providers now use Twilio:
  - `SmsProvider` sends through `Messages.json`
  - `WhatsappProvider` sends through `Messages.json` with `whatsapp:` addresses
  - `VoiceProvider` starts calls through `Calls.json`
  - voice calls send inline TwiML with a `Gather` posting back to `/provider-webhooks/twilio/voice`
  - fake providers remain unchanged for local full-journey testing
- Existing `ReceiverReplyService.handleInboundReply` remains the single business-logic path for:
  - receiver consent replies
  - receiver STOP / REPORT replies
  - check-in OK / HELP replies
  - backup contact DONE / CHECKED / RESOLVED replies
- Responses return only aggregate counts:
  - `{ ok: true, processed: number }`
- Responses intentionally exclude raw phone numbers, names, message bodies, transcripts, encrypted content, hashes, and provider payloads.
- Added config:
  - `CHANNEL_WEBHOOK_SECRET`
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_SMS_FROM_NUMBER`
  - `TWILIO_WHATSAPP_FROM_NUMBER`
  - `TWILIO_VOICE_FROM_NUMBER`
  - `PUBLIC_API_BASE_URL`
- Added design and implementation plan:
  - `docs/superpowers/specs/2026-05-01-provider-webhooks-design.md`
  - `docs/superpowers/plans/2026-05-01-provider-webhooks.md`

Files changed for this slice:

- `apps/backend/src/modules/provider-webhooks/provider-webhooks.controller.ts`
- `apps/backend/src/modules/provider-webhooks/provider-webhooks.controller.spec.ts`
- `apps/backend/src/modules/provider-webhooks/provider-webhooks.module.ts`
- `apps/backend/src/modules/channels/sms.provider.ts`
- `apps/backend/src/modules/channels/whatsapp.provider.ts`
- `apps/backend/src/modules/channels/voice.provider.ts`
- `apps/backend/src/modules/channels/twilio-http-client.ts`
- `apps/backend/src/modules/channels/twilio-rendering.ts`
- `apps/backend/src/modules/channels/channel-providers.factory.ts`
- `apps/backend/src/shared/config/app-config.service.ts`
- `apps/backend/src/shared/config/app-config.service.spec.ts`
- `apps/backend/src/app.module.ts`
- `apps/backend/.env.example`
- `docs/superpowers/specs/2026-05-01-provider-webhooks-design.md`
- `docs/superpowers/plans/2026-05-01-provider-webhooks.md`
- `docs/PROJECT_HANDOFF.md`

Focused verification:

```powershell
npm.cmd --prefix apps/backend test -- provider-webhooks.controller.spec.ts app-config.service.spec.ts
npm.cmd --prefix apps/backend test -- configured-channel-providers.spec.ts channel-providers.factory.spec.ts app-config.service.spec.ts
```

Full backend verification:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Backend full suite passed: 35 files, 160 tests.

`apps/backend/dist` was removed after build verification.

### 29b. Next Planned Slice

Harden and expand provider integration after the adapter endpoints:

- Add vendor-specific signature verification:
  - keep Twilio `X-Twilio-Signature` validation covered for messaging and voice webhook paths
  - add provider-specific validation only if a non-Twilio channel provider is introduced later
- Add delivery/status webhook handling only if product or ops workflows need it.
- Continue voice webhook hardening against the selected Twilio flow.

### 29c. Dashboard and operations hardening - completed 2026-05-01

Completed existing-surface hardening after full cascade correctness:

- Sender dashboard uses receiver terminology instead of legacy loved-one labels.
- Sidebar active navigation now points only at real Nearby receiver/admin surfaces.
- Legacy placeholder routes redirect to the main dashboard.
- Receiver detail shows `NEEDS_ATTENTION` as an actionable state with retry, backup alert, and resolve choices.
- Admin operations detail shows receiver cascade attempts separately from backup escalation attempts.
- Mobile operation types include cascade attempt records from the backend detail endpoint.
- Admin operations formatting includes attempt statuses and operational failure reasons.

Verification:

```powershell
npx vitest run apps/mobile/src/utils/adminOperations.spec.ts
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test
```

### 29d. Account data privacy and step-up - completed 2026-05-01

Completed backend-owned account data privacy foundation:

- Added OTP step-up challenge/token flow for `EXPORT_DATA` and `DELETE_ACCOUNT`.
- Added account export endpoint protected by action-scoped one-time step-up tokens.
- Added account deletion endpoint protected by action-scoped one-time step-up tokens.
- Mobile Data & Privacy actions now call the backend instead of legacy Supabase Edge Function hooks.
- Step-up OTP is sent by SMS through the existing channel provider path.

Verification:

```powershell
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
npm.cmd --prefix apps/backend test -- src/modules/account
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
```

### 29e. BRD incorporation audit and current-surface hardening - completed 2026-05-07

Purpose:

- Review the current codebase against the BRD before starting any new integration work.
- Mark what already exists in code and tighten incomplete current surfaces.
- Do not move to the next integration until the already-built foundation is fully incorporated.

Confirmed implemented surfaces:

- Auth sync and sender profile foundation.
- Receiver create/list/detail/edit/delete.
- Mandatory consent request before check-ins.
- STOP opt-out, 7-day opt-out cooldown, REPORT abuse pause, and abuse review queue.
- Backup contact CRUD and backup-contact DONE/CHECKED/RESOLVED closure.
- Scheduled check-in creation, cascade attempts, timeout handling, and `NEEDS_ATTENTION`.
- Sender actions for retry later, alert backup, and mark resolved.
- Admin operations summary/detail and abuse report review.
- Account export/delete with OTP step-up.
- Twilio is the selected provider direction for WhatsApp, SMS, and voice; fake-provider mode remains for local testing.

Hardening completed in this audit:

- Receiver detail now incorporates active backup contacts instead of returning only `backupContacts: []`.
- Receiver detail `escalation.configured` now reflects whether backup contacts exist.
- Mobile receiver-detail API type now expects real backup contact summaries.
- Dashboard, onboarding, and Data & Privacy now show BRD-required no-emergency-service language.
- Removed the mobile "Delete All Data" action because the backend only supports full account deletion with step-up; keeping a dead UI action made the current surface look more complete than it is.
- Billing copy was cleaned away from old loved-one/push language so it better matches Nearby receiver/channel terminology.

Verification:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.controller.spec.ts src/modules/backup-contacts/backup-contacts.controller.spec.ts
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
```

Verified results:

- Focused backend receiver/backup-contact tests passed: 2 files, 14 tests.
- Mobile type-check passed.
- Backend type-check passed.
- Full backend suite passed: 38 files, 169 tests.
- Backend build passed.

Current finish-before-integration blockers:

- Billing/payment is still UI-only and must not be treated as product-complete.
- Sender escalation push baseline is wired; remaining siren work is entitlement/settings polish and live push credential/device smoke.
- Channel auto-detection remains a product risk; treat it as best-effort/manual selection, not a guaranteed WhatsApp lookup.
- Real Twilio production credentials and live/sandbox smoke should wait until the current functional gaps above are closed or explicitly deferred.

### 29f. Receiver lifecycle and stale surface cleanup - completed 2026-05-07

Completed after the BRD audit recommendation:

- Receiver pause now accepts an optional `pausedUntil` end date and persists that date instead of forcing only the indefinite pause sentinel.
- Receiver pause sends a best-effort receiver lifecycle notification on the receiver's primary channel using the existing channel router.
- Receiver delete still soft-deletes, and now also sends a best-effort final "check-ins ended" receiver notification on the primary channel.
- Pause/delete lifecycle notification failures are audited but do not block the sender's management action.
- Mobile `pauseReceiver` can send an optional end date to the backend.
- Removed stale Expo `(app)` routes that still showed mock home/history/check-in/settings screens.
- Mobile manual database types now describe `receivers`, `backup_contacts`, and `check_ins` instead of old `loved_one_profiles` and `checkins`.
- Shared type exports now align to the receiver/check-in/channel model instead of the older loved-one relationship model.
- Mobile constants now expose WhatsApp/SMS/voice check-in methods and sender escalation actions, with old push/emergency-contact options removed.
- Signup/welcome copy was cleaned away from stale loved-one wording.

Verification:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.controller.spec.ts src/modules/receivers/receivers.service.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
```

Verified results:

- Focused backend receiver lifecycle tests passed: 2 files, 25 tests.
- Backend type-check passed.
- Mobile type-check passed.
- Full backend suite passed: 38 files, 170 tests.
- Backend build passed.

Remaining finish-before-integration blockers after this pass:

- Billing/payment is still UI-only and must not be treated as product-complete.
- Twilio production credential setup and live/sandbox smoke remain pending until the remaining current-surface blockers are closed or explicitly deferred.

### 29g. Sender push notifications and channel-plan hardening - completed 2026-05-07

Completed:

- Added backend `device_tokens` persistence and Prisma migration `202605070001_device_tokens`.
- Added authenticated `POST /device-tokens` for sender Expo push token registration.
- Added backend push delivery service using the Expo Push API, with stale-token deactivation for `DeviceNotRegistered`.
- Mobile now attempts Expo push-token registration after sign-in and posts the token to the backend.
- Escalation flows now notify the sender by mobile push for help responses, missed check-ins, and sender-requested backup alerts.
- Escalation events now carry `senderNotifiedAt` when at least one sender push notification is accepted.
- Push registration and sender push delivery are audited without writing raw push tokens to audit metadata.
- Added channel-plan resolution to `ChannelRouterService`.
- Receiver create/update now runs the selected channel plan through provider availability checks and falls back from unavailable WhatsApp to the next reachable fallback channel.
- Channel audit metadata now records `channelDetectionStatus`, `channelDetectionConfidence`, and unavailable channels. This makes WhatsApp reachability explicit instead of claiming guaranteed auto-detection.
- Mobile channel labels now say "WhatsApp if available" instead of implying guaranteed WhatsApp auto-detection.

Verification:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/notifications/notifications.service.spec.ts src/modules/escalations/escalations.service.spec.ts src/modules/channels/channel-router.service.spec.ts src/modules/receivers/receivers.service.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Verified results:

- Focused backend tests passed: 4 files, 30 tests.
- Backend type-check passed.
- Mobile type-check passed.
- Full backend suite passed: 39 files, 176 tests.
- Backend build passed.
- Prisma schema validation passed.

Remaining finish-before-integration blockers after this pass:

- Billing/payment is still UI-only and must not be treated as product-complete.
- Expo push requires native app push credentials and a real EAS project id before production device testing.
- Twilio production credential setup and live/sandbox smoke remain pending until billing is closed or explicitly deferred.

### 29h. Existing-surface production readiness audit - completed 2026-05-09

Purpose:

- Verify already-coded surfaces before starting new or remaining feature work.
- Confirm current module wiring, database setup scripts, fake-provider paths, Twilio adapter structure, mobile API wiring, and documentation alignment.
- Billing/payment implementation was explicitly declared out of scope for this audit and remains a known blocker.

Scope verified:

- Backend `AppModule` imports the implemented modules for account privacy, admin abuse, audit, auth, backup contacts, check-ins, channels, escalations, notifications, operations, provider webhooks, receivers, and users.
- Repository and provider bindings are present for implemented persistence and channel surfaces.
- Prisma access remains repository-oriented for implemented modules.
- Prisma schema validates with the current receiver/check-in/attempt/escalation/notification/account models.
- Fake provider mode boots without Twilio credentials.
- Twilio SMS, WhatsApp, voice provider classes and Twilio messaging/voice webhook controllers are structurally ready for credentials.
- Mobile `backendApi` methods map to implemented backend routes for receivers, backup contacts, device tokens, account step-up/export/delete, admin operations, admin abuse reports, and sender check-in actions.

Gaps fixed:

- Added `apps/backend/prisma/20260509_existing_surface_rls_hardening.sql` for hosted-project RLS hardening of already-built surfaces:
  - enables deny-by-default RLS on `admin_users`, `channel_templates`, `idempotency_keys`, `step_up_challenges`, and `device_tokens`
  - backfills `check_ins_read_own` and `check_ins_read_co_monitor` policies only if missing
- Updated `apps/backend/prisma/supabase_setup.sql` so fresh setup enables RLS on `step_up_challenges` and `device_tokens`.
- Updated `apps/backend/prisma/reset_public_schema_for_nearby.sql` so full local rebuilds include:
  - internal-table deny-by-default RLS for `admin_users`, `channel_templates`, `idempotency_keys`, `step_up_challenges`, and `device_tokens`
  - `check_ins_read_own`
  - `check_ins_read_co_monitor`
- Replaced stale visible `Family Check-In` branding with `Nearby` in active mobile surfaces.
- Updated stale shared constants away from old loved-one/push/pairing-code terminology.
- Updated README current-next-work so it no longer lists completed receiver UI/webhook/escalation work as pending.
- Added audit spec and execution plan:
  - `docs/superpowers/specs/2026-05-09-existing-surface-production-readiness-audit-design.md`
  - `docs/superpowers/plans/2026-05-09-existing-surface-production-readiness-audit.md`

Verification:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
npm.cmd --prefix apps/mobile run type-check
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; $env:KMS_MASTER_KEY_BASE64='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; $env:SUPABASE_URL='https://example.supabase.co'; $env:SUPABASE_ANON_KEY='anon-key'; $env:SUPABASE_SERVICE_ROLE_KEY='service-role-key'; $env:OPERATIONS_CRON_SECRET='cron-secret'; $env:CHANNEL_PROVIDER_MODE='fake'; npm.cmd exec -- tsx -e "import 'reflect-metadata'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './src/app.module'; (async () => { const app = await NestFactory.createApplicationContext(AppModule, { logger: false }); await app.close(); console.log('app-context-ok'); })().catch((error) => { console.error(error); process.exit(1); });"
```

Verified results:

- Backend full test suite passed: 39 files, 176 tests.
- Backend type-check passed.
- Backend build passed.
- Prisma schema validation passed.
- Mobile type-check passed.
- Nest `AppModule` application context bootstrapped successfully in fake provider mode without Twilio credentials.
- Generated `apps/backend/dist` was removed after build verification.

Remaining blockers:

- Billing/payment implementation and payment gating remain out of scope and must not be treated as complete.
- Twilio account approval and credentials are still pending; live/sandbox smoke for SMS, WhatsApp, and voice remains pending until credentials exist.
- The hosted-project RLS hardening SQL file was added to the repo, but applying it to the hosted Supabase database still requires an explicit deployment step with database credentials.
- Expo push production testing still requires native push credentials and the production EAS project setup.
- Previously exposed Supabase access tokens and database passwords still need rotation before beta/production use.

### 29i. RevenueCat billing foundation - completed 2026-05-09

Decision:

- Nearby mobile subscriptions must use Apple In-App Purchase on iOS and Google Play Billing on Android.
- Stripe/Telr/direct card checkout is not the right mobile subscription path for app-unlocked digital functionality.
- RevenueCat is the selected subscription management layer because it wraps StoreKit and Google Play Billing while giving us cross-platform entitlement sync and webhooks.

Completed:

- Added design and implementation plan:
  - `docs/superpowers/specs/2026-05-09-revenuecat-billing-foundation-design.md`
  - `docs/superpowers/plans/2026-05-09-revenuecat-billing-foundation.md`
- Added backend billing schema foundation:
  - `BillingInterval` enum: `MONTHLY`, `ANNUAL`
  - `BillingStore` enum: `APP_STORE`, `PLAY_STORE`, `STRIPE`, `PROMOTIONAL`, `UNKNOWN`
  - subscription fields for RevenueCat/store projection:
    - `externalProductId`
    - `revenueCatAppUserId`
    - `billingInterval`
    - `store`
    - `willRenew`
  - migration `apps/backend/prisma/migrations/202605090001_revenuecat_billing_foundation/migration.sql`
- Added backend `BillingModule`:
  - `GET /billing/status`
  - `POST /billing/revenuecat/webhook`
  - local entitlement rules backed by `subscriptions`
  - RevenueCat webhook auth through `REVENUECAT_WEBHOOK_AUTH_TOKEN`
  - entitlement ID config through `REVENUECAT_ENTITLEMENT_ID`, defaulting to `nearby_access`
- Added RevenueCat webhook handling for entitlement-bearing events:
  - maps App Store / Play Store events into local subscription status
  - ignores unrelated entitlement IDs
  - maps billing issues to `PAST_DUE`; paid access follows the local paid-through grace rule
  - grants access only for active, trialing, or paid-through canceled periods
  - writes PII-safe billing audit metadata only
- Added mobile RevenueCat foundation:
  - `apps/mobile/src/services/revenueCat.ts`
  - safe dynamic import wrapper for `react-native-purchases`
  - graceful unavailable state for web / Expo Go / missing SDK keys
  - billing screen now calls backend billing status and has monthly, annual, and restore purchase actions
  - `apps/mobile/.env.example` includes RevenueCat public SDK key placeholders
- Installed `react-native-purchases` with `npm install --legacy-peer-deps`.

Important Expo note:

- RevenueCat's React Native SDK contains native code.
- Real purchase testing requires a development build, TestFlight build, or Play testing build.
- Expo Go is not sufficient for live purchase testing.

Dependency note:

- `react-native-purchases` is installed at version `9.15.2`.
- Installation required `npm install --legacy-peer-deps` because the workspace has an existing React/react-dom peer resolution mismatch.
- npm audit currently reports vulnerabilities; do not run broad `npm audit fix --force` casually.

Verification:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/billing/billing.controller.spec.ts src/modules/billing/billing.service.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; $env:KMS_MASTER_KEY_BASE64='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; $env:SUPABASE_URL='https://example.supabase.co'; $env:SUPABASE_ANON_KEY='anon-key'; $env:SUPABASE_SERVICE_ROLE_KEY='service-role-key'; $env:OPERATIONS_CRON_SECRET='cron-secret'; $env:CHANNEL_PROVIDER_MODE='fake'; $env:REVENUECAT_WEBHOOK_AUTH_TOKEN='revenuecat-webhook-token'; npm.cmd exec -- tsx -e "import 'reflect-metadata'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './src/app.module'; (async () => { const app = await NestFactory.createApplicationContext(AppModule, { logger: false }); await app.close(); console.log('app-context-ok'); })().catch((error) => { console.error(error); process.exit(1); });"
```

Verified results:

- Focused backend billing tests passed: 2 files, 7 tests.
- Backend type-check passed.
- Mobile type-check passed.
- Prisma schema validation passed.
- Nest `AppModule` bootstrapped successfully in fake provider mode with RevenueCat webhook auth configured.
- After dependency installation, mobile type-check passed again with the SDK installed and no local type shim.

Remaining RevenueCat setup:

- Create RevenueCat project and apps for iOS/Android.
- Create App Store Connect and Google Play monthly/annual subscription products.
- Map products to RevenueCat entitlement `nearby_access`.
- Set `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`.
- Set backend `REVENUECAT_WEBHOOK_AUTH_TOKEN`.
- Configure RevenueCat webhook URL to `POST /billing/revenuecat/webhook`.
- Build a development/TestFlight/Play test build and run real purchase/restore/cancel smoke tests.

### 29j. Billing compliance research and payment-gating continuation - in progress 2026-05-10

Compliance decision confirmed by web research:

- RevenueCat is acceptable as the subscription management layer as long as the actual mobile transactions use Apple In-App Purchase on iOS and Google Play Billing on Android.
- Apple App Review Guideline 3.1.1 says app-unlocking features/functionality and subscriptions must use in-app purchase. Apple allows auto-renewable subscriptions when they provide ongoing value and work across the user's devices.
- Google Play Payments policy says Play-distributed apps charging for in-app features, app functionality, digital content, subscriptions, or cloud software/services must use Google Play Billing unless a specific exception or enrolled regional alternative-billing program applies.
- Do not use Stripe, Telr, direct card checkout, RevenueCat Web Billing, external web checkout links, or in-app messaging that directs users to pay elsewhere for the Nearby mobile subscription unless a future region-specific external purchase program is intentionally implemented and reviewed.
- Safe path for Nearby mobile subscriptions:
  - App Store Connect auto-renewable subscriptions for iOS.
  - Google Play Console subscriptions for Android.
  - RevenueCat products/offerings mapped to entitlement `nearby_access`.
  - Mobile app uses `react-native-purchases` / RevenueCat SDK for purchase and restore.
  - Backend trusts RevenueCat-backed entitlement state projected into local `subscriptions`.
  - Backend business flows enforce paid access with local entitlement checks.

Sources checked:

- Apple App Review Guidelines: `https://developer.apple.com/app-store/review/guidelines/`
- Google Play Payments policy: `https://support.google.com/googleplay/android-developer/answer/9858738`
- Google Play payments policy explanation: `https://support.google.com/googleplay/android-developer/answer/10281818`
- RevenueCat React Native docs: `https://www.revenuecat.com/docs/getting-started/installation/reactnative`
- RevenueCat quickstart: `https://www.revenuecat.com/docs/getting-started/quickstart`
- RevenueCat webhooks: `https://www.revenuecat.com/docs/integrations/webhooks`

Code completed in this slice:

- Added backend payment gating to `POST /receivers`.
- `ReceiversController.create` now calls `BillingService.getBillingStatus(sender.id)` after auth/user sync and before receiver creation.
- If `entitled` is false or missing, the endpoint throws `403 Active subscription required to add receivers`.
- This prevents unpaid senders from creating receivers or triggering receiver consent side effects.
- `ReceiversModule` now imports `BillingModule`.
- Added `ReceiversController` test coverage for unpaid receiver creation.

Verification completed:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.controller.spec.ts
npm.cmd --prefix apps/backend test -- src/modules/billing/billing.service.spec.ts src/modules/billing/billing.controller.spec.ts src/modules/receivers/receivers.controller.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; $env:KMS_MASTER_KEY_BASE64='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; $env:SUPABASE_URL='https://example.supabase.co'; $env:SUPABASE_ANON_KEY='anon-key'; $env:SUPABASE_SERVICE_ROLE_KEY='service-role-key'; $env:OPERATIONS_CRON_SECRET='cron-secret'; $env:CHANNEL_PROVIDER_MODE='fake'; $env:REVENUECAT_WEBHOOK_AUTH_TOKEN='revenuecat-webhook-token'; npm.cmd exec -- tsx -e "import 'reflect-metadata'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './src/app.module'; (async () => { const app = await NestFactory.createApplicationContext(AppModule, { logger: false }); await app.close(); console.log('app-context-ok'); })().catch((error) => { console.error(error); process.exit(1); });"
```

Verified results:

- Focused receiver controller spec passed.
- Focused billing + receiver specs passed: 3 files, 18 tests.
- Backend type-check passed.
- Full backend suite passed: 41 files, 184 tests.
- Backend build passed.
- Nest `AppModule` bootstrapped successfully in fake provider mode with RevenueCat webhook auth configured.

Scheduler payment-gating work completed after this plan:

- `CheckInReceiverCandidate` now includes the receiver owner `userId`.
- `PrismaCheckInsRepository.findReceiversDueForCheckIn` maps `receiver.userId` into due check-in candidates.
- `CheckInsService.sendDueCheckIns` now checks `BillingService.getBillingStatus(receiver.userId)` after receiver eligibility and before creating check-ins, creating attempts, sending provider messages/calls, or writing check-in audit events.
- Unpaid / missing-entitlement senders are counted as `skipped`.
- `CheckInsModule` imports `BillingModule`.
- `CheckInsModule` now provides `CheckInsService` through a factory so Nest does not try to resolve the test-only `now` function constructor parameter.
- Added TDD coverage:
  - repository spec failed first for missing `userId` mapping, then passed
  - service spec failed first because unpaid receivers still generated check-ins, then passed

Verification after scheduler gating:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/check-ins/prisma-check-ins.repository.spec.ts
npm.cmd --prefix apps/backend test -- src/modules/check-ins/check-ins.service.spec.ts
npm.cmd --prefix apps/backend test -- src/modules/check-ins/check-ins.service.spec.ts src/modules/check-ins/prisma-check-ins.repository.spec.ts src/modules/billing/billing.service.spec.ts
npm.cmd --prefix apps/backend run type-check
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; $env:KMS_MASTER_KEY_BASE64='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; $env:SUPABASE_URL='https://example.supabase.co'; $env:SUPABASE_ANON_KEY='anon-key'; $env:SUPABASE_SERVICE_ROLE_KEY='service-role-key'; $env:OPERATIONS_CRON_SECRET='cron-secret'; $env:CHANNEL_PROVIDER_MODE='fake'; $env:REVENUECAT_WEBHOOK_AUTH_TOKEN='revenuecat-webhook-token'; npm.cmd exec -- tsx -e "import 'reflect-metadata'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './src/app.module'; (async () => { const app = await NestFactory.createApplicationContext(AppModule, { logger: false }); await app.close(); console.log('app-context-ok'); })().catch((error) => { console.error(error); process.exit(1); });"
npm.cmd --prefix apps/backend test -- src/modules/check-ins/check-ins.service.spec.ts src/modules/check-ins/prisma-check-ins.repository.spec.ts src/modules/billing/billing.service.spec.ts src/modules/receivers/receivers.controller.spec.ts
npm.cmd --prefix apps/backend run build
npm.cmd --prefix apps/backend test
```

Verified results:

- Repository check-in spec passed: 5 tests.
- Check-in service spec passed: 5 tests.
- Focused scheduler/billing specs passed: 3 files, 14 tests.
- Backend type-check passed.
- Nest `AppModule` bootstrapped successfully in fake provider mode with RevenueCat webhook auth configured.
- Focused check-in/billing/receiver specs passed: 4 files, 25 tests.
- Backend build passed.
- Full backend suite passed: 41 files, 185 tests.

Next implementation plan if disconnected:

Payment-failure grace decision completed after this plan:

- BRD says check-ins should continue during payment retry and should not stop immediately on the first failed payment.
- Current implementation now treats `SubscriptionStatus.PAST_DUE` as entitled while `currentPeriodEnd` is still in the future.
- Expired `PAST_DUE` subscriptions remain not entitled.
- This uses the existing RevenueCat/store paid-through period as the conservative grace window without adding new schema fields.
- RevenueCat `BILLING_ISSUE` webhooks still project local subscription status to `PAST_DUE` and `willRenew: false`, but access remains available until `currentPeriodEnd`.
- No mobile code change was needed because backend gates consume `BillingService.getBillingStatus(...).entitled`.

Verification after payment-failure grace:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/billing/billing.service.spec.ts
npm.cmd --prefix apps/backend test -- src/modules/billing/billing.service.spec.ts src/modules/billing/billing.controller.spec.ts src/modules/check-ins/check-ins.service.spec.ts src/modules/receivers/receivers.controller.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; $env:KMS_MASTER_KEY_BASE64='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; $env:SUPABASE_URL='https://example.supabase.co'; $env:SUPABASE_ANON_KEY='anon-key'; $env:SUPABASE_SERVICE_ROLE_KEY='service-role-key'; $env:OPERATIONS_CRON_SECRET='cron-secret'; $env:CHANNEL_PROVIDER_MODE='fake'; $env:REVENUECAT_WEBHOOK_AUTH_TOKEN='revenuecat-webhook-token'; npm.cmd exec -- tsx -e "import 'reflect-metadata'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './src/app.module'; (async () => { const app = await NestFactory.createApplicationContext(AppModule, { logger: false }); await app.close(); console.log('app-context-ok'); })().catch((error) => { console.error(error); process.exit(1); });"
```

Verified results:

- Billing service spec passed: 5 tests.
- Focused billing/check-in/receiver specs passed: 4 files, 24 tests.
- Backend type-check passed.
- Full backend suite passed: 41 files, 186 tests.
- Backend build passed.
- Nest `AppModule` bootstrapped successfully in fake provider mode with RevenueCat webhook auth configured.

Remaining limitation:

- The exact BRD wording says payment retries happen 3 times over 7 days and suspension after 14 days unpaid. That retry/suspension state is not modeled yet. Current behavior is intentionally store-period based: allow until RevenueCat/store `currentPeriodEnd`, deny after it expires.

1. Decide whether to model explicit retry/suspension state later.
   - BRD says payment failure retries over 7 days should continue check-ins; after the third failure check-ins pause; after 14 days unpaid account is suspended.
   - Current implementation does not store retry count, first billing failure timestamp, or suspension timestamp.
   - Add explicit fields/rules only if RevenueCat/store grace period is not enough for launch.
   - Do not silently implement a separate retry system without tests and product decision.

RevenueCat webhook idempotency hardening completed after this plan:

- RevenueCat docs say webhook retries use the same event `id` and recommend idempotent processing by tracking that id.
- `BillingController` now requires `event.id` in RevenueCat webhook payloads and maps it to `RevenueCatWebhookEvent.eventId`.
- `BillingService.syncRevenueCatEvent` now records `eventId` before mutating subscriptions or writing billing audit logs.
- Duplicate RevenueCat events return `{ processed: false }` and do not re-upsert subscription state or emit duplicate audit logs.
- `PrismaBillingRepository` stores processed RevenueCat event ids in the existing `idempotency_keys` table using keys shaped as `revenuecat:<eventId>` and scope `billing.revenuecat_webhook`.
- Idempotency keys currently expire after 90 days.
- No migration was required because `idempotency_keys` already exists.

Verification after RevenueCat webhook idempotency:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/billing/billing.service.spec.ts src/modules/billing/billing.controller.spec.ts
npm.cmd --prefix apps/backend test -- src/modules/billing/prisma-billing.repository.spec.ts
npm.cmd --prefix apps/backend test -- src/modules/billing/billing.service.spec.ts src/modules/billing/billing.controller.spec.ts src/modules/billing/prisma-billing.repository.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; $env:KMS_MASTER_KEY_BASE64='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; $env:SUPABASE_URL='https://example.supabase.co'; $env:SUPABASE_ANON_KEY='anon-key'; $env:SUPABASE_SERVICE_ROLE_KEY='service-role-key'; $env:OPERATIONS_CRON_SECRET='cron-secret'; $env:CHANNEL_PROVIDER_MODE='fake'; $env:REVENUECAT_WEBHOOK_AUTH_TOKEN='revenuecat-webhook-token'; npm.cmd exec -- tsx -e "import 'reflect-metadata'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './src/app.module'; (async () => { const app = await NestFactory.createApplicationContext(AppModule, { logger: false }); await app.close(); console.log('app-context-ok'); })().catch((error) => { console.error(error); process.exit(1); });"
```

Verified results:

- Billing controller/service specs passed: 2 files, 10 tests.
- Prisma billing repository spec passed: 2 tests.
- Focused billing specs passed: 3 files, 12 tests.
- Backend type-check passed.
- Full backend suite passed: 42 files, 190 tests.
- Backend build passed.
- Nest `AppModule` bootstrapped successfully in fake provider mode with RevenueCat webhook auth configured.

Remaining RevenueCat webhook hardening options:

- RevenueCat docs recommend using webhooks as notifications and syncing canonical customer state from RevenueCat APIs for maximum correctness.
- Current backend still maps subscription state from the webhook event payload directly.
- Add a RevenueCat API client later if sandbox/live tests show event payload projection is not sufficient.
- Also consider storing RevenueCat `environment`, `original_transaction_id`, and `event_timestamp_ms` if operational replay/debugging needs grow.

Mobile paid-access UX polish completed after this plan:

- Added `apps/mobile/src/services/backendErrors.ts`.
- `BackendRequestError` now carries backend HTTP status for failed backend calls.
- `backendRequest` now throws `BackendRequestError(message, response.status)` instead of a plain `Error` for non-OK backend responses.
- Added `isPaidAccessRequiredError` helper for the backend `403 Active subscription required to add receivers` response.
- Receiver setup/onboarding now shows a billing-specific alert when receiver creation is blocked by paid-access gating:
  - title: `Subscription required`
  - message: `Choose monthly or annual access to add receivers and start check-ins.`
  - secondary action routes to `/(main)/settings/billing`
- Generic receiver creation failures still use the existing `Unable to add receiver` alert.
- Added `apps/mobile/src/services/backendErrors.spec.ts` for paid-access error classification.

Verification after mobile paid-access UX polish:

```powershell
npx vitest run apps/mobile/src/services/backendErrors.spec.ts
npm.cmd --prefix apps/mobile run type-check
```

Verified results:

- Mobile backend error helper spec passed: 1 file, 2 tests.
- Mobile type-check passed.

Mobile RevenueCat offering metadata slice completed after this plan:

- RevenueCat docs confirm `Purchases.getOfferings()` returns current offering packages, and monthly/annual packages expose underlying store product metadata including `product.priceString`.
- Added `apps/mobile/src/services/revenueCatPlans.ts` as a pure formatter for RevenueCat offering packages.
- Added `revenueCatPlanOptionsFromOffering` to map monthly/annual packages into display-ready plan options with:
  - interval
  - display name
  - description
  - store price string
  - package identifier
- `apps/mobile/src/services/revenueCat.ts` now exports `getRevenueCatPlanOptions(userId)` and uses the pure formatter after configuring RevenueCat.
- Billing screen now loads RevenueCat plan options when the user is signed in and RevenueCat is configured.
- Billing screen displays store-backed `priceString` when offerings are available.
- Billing screen keeps the previous static monthly/annual fallback when RevenueCat is unavailable or not configured.
- Added `apps/mobile/src/services/revenueCat.spec.ts`.

Verification after mobile RevenueCat offering metadata:

```powershell
npx vitest run apps/mobile/src/services/revenueCat.spec.ts apps/mobile/src/services/backendErrors.spec.ts
npm.cmd --prefix apps/mobile run type-check
```

Verified results:

- Mobile service specs passed: 2 files, 4 tests.
- Mobile type-check passed.

RevenueCat app-user-id alignment slice completed after this plan:

- Found and fixed a critical billing identity mismatch:
  - mobile `AuthContext.user.id` is the Supabase Auth user id
  - backend billing gates and `subscriptions.userId` use the synced backend `users.id`
  - RevenueCat `appUserID` must match backend `users.id`, otherwise webhook subscription projection can fail or land on the wrong identifier
- Billing screen now calls `syncAuthenticatedUser()` and stores the returned backend user id as the RevenueCat app user id.
- Billing screen now uses the backend user id for:
  - `getRevenueCatPlanOptions`
  - `purchaseRevenueCatPackage`
  - `restoreRevenueCatPurchases`
- `BillingService.syncRevenueCatEvent` now rejects RevenueCat events whose `appUserId` does not match an existing synced backend user before recording idempotency or mutating subscription state.
- This makes misconfigured RevenueCat app user ids fail explicitly instead of relying on database foreign-key behavior.

Verification after RevenueCat app-user-id alignment:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/billing/billing.service.spec.ts
npm.cmd --prefix apps/backend test -- src/modules/billing/billing.service.spec.ts src/modules/billing/billing.controller.spec.ts src/modules/billing/prisma-billing.repository.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
npx vitest run apps/mobile/src/services/revenueCat.spec.ts apps/mobile/src/services/backendErrors.spec.ts
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; $env:KMS_MASTER_KEY_BASE64='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; $env:SUPABASE_URL='https://example.supabase.co'; $env:SUPABASE_ANON_KEY='anon-key'; $env:SUPABASE_SERVICE_ROLE_KEY='service-role-key'; $env:OPERATIONS_CRON_SECRET='cron-secret'; $env:CHANNEL_PROVIDER_MODE='fake'; $env:REVENUECAT_WEBHOOK_AUTH_TOKEN='revenuecat-webhook-token'; npm.cmd exec -- tsx -e "import 'reflect-metadata'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './src/app.module'; (async () => { const app = await NestFactory.createApplicationContext(AppModule, { logger: false }); await app.close(); console.log('app-context-ok'); })().catch((error) => { console.error(error); process.exit(1); });"
```

Verified results:

- Billing service spec passed: 7 tests.
- Focused billing specs passed: 3 files, 13 tests.
- Backend type-check passed.
- Mobile type-check passed.
- Mobile service specs passed: 2 files, 4 tests.
- Full backend suite passed: 42 files, 191 tests.
- Backend build passed.
- Nest `AppModule` bootstrapped successfully in fake provider mode with RevenueCat webhook auth configured.

Machine-readable paid-access error slice completed after this plan:

- Receiver creation now returns a stable backend error payload when a sender lacks entitlement:
  - `code: "PAID_ACCESS_REQUIRED"`
  - `message: "Active subscription required to add receivers"`
- Mobile `BackendRequestError` now carries an optional `code`.
- Mobile backend API error parsing preserves backend `code` from JSON error bodies.
- `isPaidAccessRequiredError` now prefers `PAID_ACCESS_REQUIRED` and keeps the previous exact-message fallback so older backend responses still route users to billing.
- Converted `apps/mobile/src/services/auth-storage.test.ts` from a standalone self-running script into a real Vitest suite after the broad mobile test run exposed it as a discovery failure.

Verification after machine-readable paid-access error slice:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.controller.spec.ts
npx vitest run apps/mobile/src/services/backendApi.spec.ts apps/mobile/src/services/backendErrors.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; $env:KMS_MASTER_KEY_BASE64='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; $env:SUPABASE_URL='https://example.supabase.co'; $env:SUPABASE_ANON_KEY='anon-key'; $env:SUPABASE_SERVICE_ROLE_KEY='service-role-key'; $env:OPERATIONS_CRON_SECRET='cron-secret'; $env:CHANNEL_PROVIDER_MODE='fake'; $env:REVENUECAT_WEBHOOK_AUTH_TOKEN='revenuecat-webhook-token'; npm.cmd exec -- tsx -e "import 'reflect-metadata'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './src/app.module'; (async () => { const app = await NestFactory.createApplicationContext(AppModule, { logger: false }); await app.close(); console.log('app-context-ok'); })().catch((error) => { console.error(error); process.exit(1); });"
npx vitest run apps/mobile/src
```

Verified results:

- Receiver controller spec passed: 11 tests.
- Mobile backend API/error specs passed: 2 files, 4 tests.
- Backend type-check passed.
- Full backend suite passed: 42 files, 191 tests.
- Mobile type-check passed.
- Backend build passed.
- Nest `AppModule` bootstrapped successfully in fake provider mode with RevenueCat webhook auth configured.
- Full mobile source test run passed: 6 files, 20 tests.

RevenueCat entitlement config normalization slice completed after this plan:

- Confirmed `REVENUECAT_ENTITLEMENT_ID` was already wired through `AppConfigService` into `BillingService`.
- Fixed the remaining launch-risk edge case: blank or whitespace-only `REVENUECAT_ENTITLEMENT_ID` now falls back to `nearby_access` instead of causing all RevenueCat entitlement events to be ignored.
- Configured entitlement ids are trimmed before use, so accidental spaces in deployment env vars do not break entitlement matching.
- `.env.example` already documents `REVENUECAT_ENTITLEMENT_ID="nearby_access"`, so no example change was required.

Verification after RevenueCat entitlement config normalization:

```powershell
npm.cmd --prefix apps/backend test -- src/shared/config/app-config.service.spec.ts
npm.cmd --prefix apps/backend test -- src/modules/billing/billing.service.spec.ts src/modules/billing/billing.controller.spec.ts
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; $env:KMS_MASTER_KEY_BASE64='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; $env:SUPABASE_URL='https://example.supabase.co'; $env:SUPABASE_ANON_KEY='anon-key'; $env:SUPABASE_SERVICE_ROLE_KEY='service-role-key'; $env:OPERATIONS_CRON_SECRET='cron-secret'; $env:CHANNEL_PROVIDER_MODE='fake'; $env:REVENUECAT_WEBHOOK_AUTH_TOKEN='revenuecat-webhook-token'; $env:REVENUECAT_ENTITLEMENT_ID='   '; npm.cmd exec -- tsx -e "import 'reflect-metadata'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './src/app.module'; import { AppConfigService } from './src/shared/config/app-config.service'; (async () => { const app = await NestFactory.createApplicationContext(AppModule, { logger: false }); const config = app.get(AppConfigService); console.log('app-context-ok entitlement=' + config.revenueCatEntitlementId); await app.close(); })().catch((error) => { console.error(error); process.exit(1); });"
```

Verified results:

- App config spec passed: 4 tests.
- Focused billing controller/service specs passed: 2 files, 11 tests.
- Backend type-check passed.
- Full backend suite passed: 42 files, 193 tests.
- Backend build passed.
- Nest `AppModule` bootstrapped successfully with blank `REVENUECAT_ENTITLEMENT_ID`, and config reported `entitlement=nearby_access`.

Canonical RevenueCat app-user-id status slice completed after this plan:

- `GET /billing/status` now includes `revenueCatAppUserId`, set to the canonical backend `users.id`.
- This gives mobile the exact app user id RevenueCat must use without requiring a separate `/auth/sync-user` call during billing screen load.
- Billing screen now loads billing status first, caches `status.revenueCatAppUserId`, and uses that id for `getRevenueCatPlanOptions`.
- Purchase/restore still keep the existing `syncAuthenticatedUser()` fallback only if no cached billing status id is available.
- Backend check-in service test doubles were updated to match the expanded billing status contract.

Verification after canonical RevenueCat app-user-id status slice:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/billing/billing.service.spec.ts src/modules/billing/billing.controller.spec.ts
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test -- src/modules/check-ins/check-ins.service.spec.ts src/modules/billing/billing.service.spec.ts src/modules/billing/billing.controller.spec.ts
npm.cmd --prefix apps/backend test
npx vitest run apps/mobile/src
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; $env:KMS_MASTER_KEY_BASE64='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; $env:SUPABASE_URL='https://example.supabase.co'; $env:SUPABASE_ANON_KEY='anon-key'; $env:SUPABASE_SERVICE_ROLE_KEY='service-role-key'; $env:OPERATIONS_CRON_SECRET='cron-secret'; $env:CHANNEL_PROVIDER_MODE='fake'; $env:REVENUECAT_WEBHOOK_AUTH_TOKEN='revenuecat-webhook-token'; npm.cmd exec -- tsx -e "import 'reflect-metadata'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './src/app.module'; (async () => { const app = await NestFactory.createApplicationContext(AppModule, { logger: false }); await app.close(); console.log('app-context-ok'); })().catch((error) => { console.error(error); process.exit(1); });"
```

Verified results:

- Focused billing controller/service specs passed: 2 files, 11 tests.
- Mobile type-check passed.
- Backend type-check passed after updating stale test doubles.
- Focused check-in/billing specs passed: 3 files, 16 tests.
- Full backend suite passed: 42 files, 191 tests.
- Full mobile source test run passed: 6 files, 20 tests.
- Backend build passed.
- Nest `AppModule` bootstrapped successfully in fake provider mode with RevenueCat webhook auth configured.

4. External setup still required before live purchase testing.
   - Create RevenueCat project and iOS/Android apps.
   - Create App Store Connect and Google Play subscription products.
   - Map monthly/annual products to RevenueCat offering(s) and entitlement `nearby_access`.
   - Set `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, and backend `REVENUECAT_WEBHOOK_AUTH_TOKEN`.
   - Configure RevenueCat webhook URL to `POST /billing/revenuecat/webhook`.
   - Build a development/TestFlight/Play test build; Expo Go is not sufficient for real purchase testing.

Immediate first commands in next session:

```powershell
Get-Content -LiteralPath PROJECT_HANDOFF.md
git status --short --branch
npm.cmd --prefix apps/backend test -- src/modules/billing/billing.service.spec.ts src/modules/billing/billing.controller.spec.ts src/modules/receivers/receivers.controller.spec.ts
```

### 30. Production readiness checklist

Use this before beta, production launch, or inviting real users into the hosted environment:

- Smoke data cleanup:
  - `Backup Smoke Receiver` and current `Resolution Smoke ...` receivers were soft-deleted on 2026-04-30
  - check whether any future smoke rows exist before beta
  - remove related disposable smoke check-ins, escalation events, and audit rows if they exist and are clearly tied to smoke testing
- Destructive cleanup rule:
  - execute deletes only after explicit action-time approval
  - preserve audit/legal records unless there is a clear dev-only reason and approved cleanup path
- Credentials and secrets:
  - rotate any Supabase access tokens, database passwords, and test-account passwords pasted in chat or logs
  - confirm `.env` files are local-only and not committed
- Supabase Auth security:
  - enable leaked password protection in the Dashboard before beta/production access
- Data separation:
  - keep future smoke/beta data in a dedicated dev/staging environment where possible
  - avoid using production for repeat smoke tests after launch
- Auth and API smoke:
  - verify web login, Android login, dashboard load, receiver detail load, and authenticated backend calls
  - verify backup-contact create/edit still preserves phone when edit phone is blank
- Compliance basics:
  - confirm receiver consent flow before sends
  - confirm STOP opt-out and REPORT abuse paths remain available
  - confirm audit logs avoid raw PII
- Operational readiness:
  - provision `admin_users` rows for actual admin Supabase identities before using admin endpoints outside tests
  - confirm provider keys and channel routing are configured for the target environment
  - confirm admin abuse-monitoring workflow exists before real users
  - confirm payment/tier gating is enabled before charging users

### 31. Remaining launch work

- Continue the BRD gap closure pass for any newly identified current-surface gaps. Terms/privacy links remain intentionally deferred until the end per product-owner instruction.
- RevenueCat/App Store Connect/Google Play external setup and real purchase/restore/cancel smoke testing.
- Twilio production credential setup and end-to-end sandbox/live smoke for WhatsApp, SMS, and voice after current-surface gaps are handled or explicitly deferred.
- Production Expo/EAS push credentials before production device push testing.
- Rotate the Supabase access token and DB password pasted in chat.

### 32. BRD gap closure pass - in progress 2026-05-15

Purpose:

- Close audited gaps in small slices.
- For each slice: write/adjust a regression test first, verify it fails for the expected gap, implement the smallest fix, rerun targeted verification, update this handoff, then continue.
- Terms/privacy links are intentionally deferred until the end per product-owner instruction.

Slice 1 completed - Twilio voice reply receiver matching:

- Gap: outbound Twilio voice calls use `From` as the platform caller ID and `To` as the receiver, but the voice DTMF webhook normalized `From` into the receiver reply identity. Voice `1` / `2` replies could therefore fail to match the receiver/check-in.
- Fix: `ProviderWebhooksController.extractTwilioVoiceReply` now normalizes `body.To` as the receiver phone for voice replies.
- Regression test: `provider-webhooks.controller.spec.ts` now models real Twilio voice callback shape with `From` as caller ID and `To` as receiver.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/provider-webhooks/provider-webhooks.controller.spec.ts`
  - Failed before fix because handled `fromPhone` was `+15550003333` instead of `+971500000000`.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/provider-webhooks/provider-webhooks.controller.spec.ts`
  - Passed: 1 file, 11 tests.

Slice 2 completed - receiver removal step-up and native OTP entry:

- Gap: BRD requires MFA/OTP for removing a receiver. Mobile could delete a receiver directly, and backend `DELETE /receivers/:receiverId` did not consume a step-up token.
- Gap: account data privacy step-up depended on browser `prompt` or platform-specific `Alert.prompt`; Android/native paths could show "SMS code entry is not available" and fail to complete step-up.
- Fixes:
  - Added Prisma `SensitiveAction.REMOVE_RECEIVER` and migration `202605150001_receiver_remove_step_up`.
  - `AccountController` now allows `REMOVE_RECEIVER` step-up requests.
  - `ReceiversController.delete` now requires `x-nearby-step-up-token` and consumes it for `REMOVE_RECEIVER` before soft-delete.
  - Mobile `deleteReceiver` now requires and forwards the step-up token.
  - Receiver detail removal flow now requests/verifies `REMOVE_RECEIVER` before calling delete.
  - Data/privacy and receiver removal flows now use an in-app `StepUpCodeModal`, so native Android/iOS do not depend on browser prompt support.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.controller.spec.ts`
  - Failed before fix because receiver delete did not consume a step-up token.
  - `npm.cmd exec -- vitest run apps/mobile/src/services/backendApi.spec.ts`
  - Failed before fix because delete request headers did not include `x-nearby-step-up-token`.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.controller.spec.ts src/modules/account/account.controller.spec.ts`
  - Passed: 2 files, 14 tests.
  - `npm.cmd exec -- vitest run apps/mobile/src/services/backendApi.spec.ts`
  - Passed: 1 file, 2 tests.
  - `npm.cmd --prefix apps/backend run type-check`
  - Passed.
  - `npm.cmd --prefix apps/mobile run type-check`
  - Passed.
- Remaining in this category:
  - Payment-method-change MFA is still not applicable to a coded route because payment-method mutation is not implemented yet.

Slice 3 completed - signup sender phone metadata:

- Gap: BRD requires sender signup with email and phone. The mobile signup screen collected only name/email/password, while backend sender sync requires a phone number from Supabase Auth `phone` or `user_metadata.phone`.
- Fixes:
  - Signup screen now collects sender phone with country code.
  - `useAuth.signUp` and `signUpWithEmail` now accept phone/country/timezone metadata.
  - Supabase email signup now stores `user_metadata.phone`, allowing backend sync to create the sender profile when Supabase Auth `phone` is empty.
- Red verification:
  - `npm.cmd exec -- vitest run apps/mobile/src/services/auth.spec.ts`
  - Failed before fix because signup metadata did not include `phone`.
- Green verification:
  - `npm.cmd exec -- vitest run apps/mobile/src/services/auth.spec.ts`
  - Passed: 1 file, 1 test.
  - `npm.cmd --prefix apps/mobile run type-check`
  - Passed.
- Remaining in this category:
  - Actual SMS OTP verification for sender phone still requires a provider-backed phone verification flow/Supabase phone auth configuration. Code now preserves the phone needed by backend sync, but live OTP should not be claimed complete until Supabase/Twilio phone verification is enabled and smoke-tested.

Slice 4 completed - SMS profile voice fallback:

- Gap: BRD defines the SMS receiver tech profile as SMS primary with voice fallback. Mobile onboarding and receiver edit both sent `fallbackChannels: []` for SMS.
- Fixes:
  - Added shared `CHANNEL_PROFILE_OPTIONS` utility for mobile channel profile defaults.
  - SMS profile now uses `primaryChannel: SMS` and `fallbackChannels: [VOICE]`.
  - Onboarding and receiver detail edit now consume the same shared profile defaults.
- Red verification:
  - `npm.cmd exec -- vitest run apps/mobile/src/utils/channelProfiles.spec.ts`
  - Failed before utility implementation because the shared profile defaults did not exist.
- Green verification:
  - `npm.cmd exec -- vitest run apps/mobile/src/utils/channelProfiles.spec.ts`
  - Passed: 1 file, 1 test.
  - `npm.cmd --prefix apps/mobile run type-check`
  - Passed.

Slice 5 completed - voice-only retry attempt schedule:

- Twilio review finding: the Twilio voice provider, signed Twilio webhook endpoints, hosted-audio `<Gather><Play>` TwiML, AMD/status callback persistence, and sticky caller-ID assignment are wired structurally. Live Twilio credential setup and sandbox/live smoke remain pending.
- Gap: the handoff/BRD voice retry plan requires a voice-only/landline check-in to have the initial call plus two retry attempts, with retry 1 after 15 minutes and retry 2 after another 30 minutes. The coded cascade created only one voice attempt record for voice-only/landline receivers.
- Fix: `CheckInsService.buildCascadeAttempts` now creates three voice attempts for `VOICE_ONLY` and `LANDLINE` receiver tech profiles at scheduled offsets `0`, `15`, and `45` minutes.
- Regression test: `check-ins.service.spec.ts` verifies that a voice-only receiver creates three scheduled voice attempts while sending only the first attempt immediately.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- check-ins.service.spec.ts`
  - Failed before fix because only attempt 1 existed.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- check-ins.service.spec.ts`
  - Passed: 1 file, 8 tests.
- Remaining Twilio code gaps found in review:
  - Twilio WhatsApp outbound is structurally wired through Twilio Messages API, but live approved template/content configuration and sandbox/live smoke are still pending.

Slice 6 completed - Twilio voice callback attempt failure state:

- Gap: Twilio voice AMD/status callbacks were persisted for audit but did not update the matching `check_in_attempts` row. Terminal Twilio results such as `busy`, `failed`, `no-answer`, `canceled`, or non-human AMD values could leave a sent voice attempt in `SENT` state until generic timeout handling.
- Fixes:
  - Added `CheckInsService.recordVoiceProviderFailure` to translate terminal Twilio status/AMD fields into failed voice attempt state.
  - Added repository support to find the latest sent attempt by Twilio `CallSid` / `providerMessageId` and mark it `FAILED` with `providerStatus`, `completedAt`, and a Twilio-specific `failureReason`.
  - Twilio voice status and AMD webhook handlers now persist the raw event and then call the check-in service failure transition path. Human AMD and non-terminal statuses intentionally return `updated: false`.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- check-ins.service.spec.ts`
  - Failed before fix because `recordVoiceProviderFailure` did not exist.
  - `npm.cmd --prefix apps/backend test -- provider-webhooks.controller.spec.ts`
  - Failed before controller wiring because the signed status/AMD endpoints did not call the check-in service.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- check-ins.service.spec.ts`
  - Passed: 1 file, 9 tests.
  - `npm.cmd --prefix apps/backend test -- provider-webhooks.controller.spec.ts`
  - Passed: 1 file, 11 tests.
  - `npm.cmd --prefix apps/backend test -- receiver-reply.service.spec.ts provider-webhooks.controller.spec.ts check-ins.service.spec.ts`
  - Passed: 3 files, 28 tests.
- Remaining Twilio work:
  - Live Twilio credentials, approved WhatsApp template/content setup, compliant sender/caller IDs, and sandbox/live smoke remain pending.
  - Status/AMD callbacks now mark terminal attempt failure; retry dispatch still depends on the existing cascade processing job picking up due pending attempts rather than being launched synchronously inside the webhook request.

Slice 7 completed - final Twilio voice failure closes cascade:

- Gap: after Slice 6, terminal Twilio status/AMD callbacks could mark the final sent voice attempt `FAILED` without moving the parent check-in out of `SENT` when no pending retry attempts remained. This could leave a fully exhausted voice cascade stuck instead of surfacing sender action.
- Fixes:
  - `CheckInsService.recordVoiceProviderFailure` now checks whether the failed attempt's check-in still has pending attempts.
  - If no pending attempts remain, it marks the check-in `NEEDS_ATTENTION` and writes the same `check_in.needs_attention` audit event used by normal cascade exhaustion.
  - Added `CheckInsRepository.findById` so the callback path can load the real receiver id for PII-safe audit metadata.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/check-ins/check-ins.service.spec.ts`
  - Failed before fix because `repository.needsAttentionCheckInIds` stayed empty after a final `no-answer` callback.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/check-ins/check-ins.service.spec.ts`
  - Passed: 1 file, 10 tests.
  - `npm.cmd --prefix apps/backend run type-check`
  - Passed.
  - `npm.cmd --prefix apps/backend test -- src/modules/receivers/receiver-reply.service.spec.ts src/modules/provider-webhooks/provider-webhooks.controller.spec.ts src/modules/check-ins/prisma-check-ins.repository.spec.ts`
  - Passed: 3 files, 24 tests.

Slice 8 completed - backup alerts use SMS and WhatsApp:

- Gap: BRD requires sender-initiated backup alerts to send via SMS and WhatsApp simultaneously to each backup contact, but the coded escalation path sent only SMS.
- Fixes:
  - `EscalationsService` now attempts each backup contact over both `SMS` and `WHATSAPP`.
  - It records one escalation event per contact/channel and keeps result counts contact-oriented: a backup contact is `succeeded` if at least one channel is accepted, and `failed` only if all attempted channels fail.
  - Existing PII-safe audit behavior is preserved; audit metadata records channel/status/contact ids without raw phone/name content.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/escalations/escalations.service.spec.ts`
  - Failed before fix because the WhatsApp fake provider received zero messages.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/escalations/escalations.service.spec.ts`
  - Passed: 1 file, 8 tests.
  - `npm.cmd --prefix apps/backend run type-check`
  - Passed.
  - `npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.service.spec.ts src/modules/receivers/receiver-reply.service.spec.ts src/modules/escalations/prisma-escalations.repository.spec.ts`
  - Passed: 3 files, 29 tests.

Slice 9 completed - social signup preserves sender phone:

- Gap: the mobile signup screen exposed Google/Apple signup, but the OAuth path did not collect or persist sender phone metadata. Backend sender sync rejects Supabase users without `phone` or `user_metadata.phone`, so social signup could authenticate but fail the app-user sync contract.
- Fixes:
  - `signInWithGoogle` and `signInWithApple` now accept sender signup metadata and persist phone/country/timezone with `supabase.auth.updateUser` after OAuth deep-link completion.
  - Signup Google/Apple buttons now require the sender phone field before launching OAuth and pass the same metadata shape used by email signup.
  - Successful social signup now calls `syncAuthenticatedUser()` after OAuth metadata persistence, matching the backend sender creation contract.
- Red verification:
  - `npx vitest run apps/mobile/src/services/auth.spec.ts`
  - Failed before fix because `supabase.auth.updateUser` was never called after Google OAuth completion.
- Green verification:
  - `npx vitest run apps/mobile/src/services/auth.spec.ts`
  - Passed: 1 file, 2 tests.
  - `npm.cmd --prefix apps/mobile run type-check`
  - Passed.
  - `npx vitest run apps/mobile/src`
  - Passed: 8 files, 24 tests.
- Remaining in this category:
  - Live provider-side social OAuth configuration and sender phone verification smoke remain pending until accounts/credentials are available.

Slice 10 completed - escalation push siren baseline:

- Gap: escalation notifications to the sender were plain Expo push payloads. BRD baseline calls for emergency-style sender alerts: high-priority push, Android emergency channel, iOS time-sensitive behavior where available, and an incident/status deep-link signal.
- Fixes:
  - Added `NotificationsService.sendEscalationAlertToUser` so escalation alerts use a dedicated push shape instead of the generic push method.
  - Escalation sender notifications now send `sound: 'default'`, `priority: 'high'`, `channelId: 'emergency-alerts'`, `interruptionLevel: 'timeSensitive'`, and data markers `notificationType: 'escalation_siren'` plus `deepLink`.
  - Mobile push registration now creates the Android `emergency-alerts` channel before token registration, with max importance, default sound, vibration, lock-screen visibility, and no DND bypass claim until onboarding/settings support is available.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/notifications/notifications.service.spec.ts`
  - Failed before fix because `sendEscalationAlertToUser` did not exist.
  - `npx vitest run apps/mobile/src/services/pushNotifications.spec.ts`
  - Failed before fix because Android registration did not create the emergency alert channel.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/notifications/notifications.service.spec.ts`
  - Passed: 1 file, 3 tests.
  - `npm.cmd --prefix apps/backend test -- src/modules/notifications/notifications.service.spec.ts src/modules/escalations/escalations.service.spec.ts`
  - Passed: 2 files, 11 tests.
  - `npx vitest run apps/mobile/src/services/pushNotifications.spec.ts apps/mobile/src/services/auth.spec.ts`
  - Passed: 2 files, 3 tests.
  - `npm.cmd --prefix apps/backend run type-check`
  - Passed.
  - `npm.cmd --prefix apps/mobile run type-check`
  - Passed.
- Remaining in this category:
  - iOS Critical Alerts entitlement/authorization, Android DND bypass onboarding/settings, custom bundled siren sound, "Test my siren", and sender no-acknowledgement fallback voice remain future slices.

Slice 11 completed - receiver request validation returns 400-class errors:

- Gap: receiver create/update request-shape checks used a controller `required()` helper that threw plain `Error`. Missing enum/body fields could therefore surface as generic server errors instead of bad requests.
- Fix: `ReceiversController.required()` now throws `BadRequestException`, keeping missing required receiver request fields in the 400-class validation path.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.controller.spec.ts`
  - Failed before fix because missing `relationshipType` rejected with plain `Error`, not `BadRequestException`.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.controller.spec.ts`
  - Passed: 1 file, 12 tests.
  - `npm.cmd --prefix apps/backend run type-check`
  - Passed.
  - `npm.cmd --prefix apps/backend test`
  - Passed: 44 files, 212 tests.

Slice 11b completed - receiver service validation maps to 400-class errors:

- Gap: the fresh scan found that receiver create/update empty string validation still happened inside `ReceiversService` and threw plain `Error`. Those service validation errors could still escape controller handling as generic server errors.
- Fix: `ReceiversController` now maps known receiver input validation failures from create/update service calls to `BadRequestException` while preserving unrelated service failures.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.controller.spec.ts`
  - Failed before fix because a simulated `Receiver name is required` service validation error escaped as plain `Error`.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/receivers/receivers.controller.spec.ts`
  - Passed: 1 file, 13 tests.

Slice 12 completed - manual/shared type enums align with Prisma schema:

- Gap: manual/shared type surfaces had drifted from `apps/backend/prisma/schema.prisma`: `TechProfile` missed `LANDLINE`, consent statuses included old non-Prisma values, shared relationship types included old values, and subscription enum names did not match the backend schema.
- Fixes:
  - Updated `packages/shared-types/types/index.ts` enum unions to match Prisma for `RelationshipType`, `TechProfile`, `ConsentStatus`, `SubscriptionTier`, and `SubscriptionStatus`.
  - Updated `apps/mobile/src/services/database.types.ts` to export `RelationshipType` and `TechProfile`, include `LANDLINE`, align `ConsentStatus`, and type receiver `relationship_type` / `tech_profile` fields with those unions.
  - Added compile-time schema alignment contract files so future enum drift fails under `tsc`.
- Red verification:
  - `npx tsc --noEmit --strict --moduleResolution node --target ES2020 packages/shared-types/types/schema-alignment.spec.ts apps/mobile/src/services/database.types.spec.ts`
  - Failed before fix because mobile DB types lacked `RelationshipType`/`TechProfile` exports and both type surfaces differed from Prisma enum unions.
- Green verification:
  - `npx tsc --noEmit --strict --module ESNext --moduleResolution bundler --target ES2020 packages/shared-types/types/schema-alignment.spec.ts apps/mobile/src/services/database.types.spec.ts`
  - Passed.
  - `npx vitest run apps/mobile/src packages/shared-types/types/schema-alignment.spec.ts`
  - Passed: 11 files, 27 tests.
  - `npm.cmd --prefix apps/mobile run type-check`
  - Passed.
  - `npm.cmd --prefix apps/backend run type-check`
  - Passed.

Full verification after slices 1-12 plus 11b:

- `npm.cmd --prefix apps/backend test`
  - Passed: 44 files, 213 tests.
- `npm.cmd --prefix apps/backend run type-check`
  - Passed.
- `npm.cmd --prefix apps/mobile run type-check`
  - Passed.
- `npx vitest run apps/mobile/src`
  - Passed: 10 files, 26 tests.
- `$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate`
  - Passed.
- Nest `AppModule` fake-provider bootstrap with RevenueCat webhook auth configured:
  - Passed: `app-context-ok`.

### 33. Optimization pass - in progress 2026-05-15

Slice 1 completed - mobile startup import splitting:

- Gap: several mobile routes imported the broad `services` barrel, which re-exported backend API, user-data, biometric, and RevenueCat modules together. This made route bundles more likely to pull unrelated native-facing code.
- Gap: `AuthContext` imported push notification registration at root layout startup, even though registration only runs after an authenticated session exists.
- Fixes:
  - Changed mobile screens/hooks/utils to import directly from `services/backendApi`, `services/backendErrors`, `services/userData`, or specific data modules instead of broad barrels.
  - Changed authenticated push registration to dynamic import `services/pushNotifications` only after `session.user` exists.
  - Changed onboarding/sign-up/receiver screens and selectors to import `COUNTRIES`, language data, and country types from their specific data files instead of the `data` barrel.
- Verification:
  - `npm.cmd --prefix apps/mobile run type-check`
  - Passed.
  - `npm.cmd exec -- vitest run apps/mobile/src/services/backendApi.spec.ts apps/mobile/src/utils/channelProfiles.spec.ts apps/mobile/src/services/auth.spec.ts`
  - Passed: 3 files, 4 tests.

Slice 2 completed - drawer context render stability:

- Gap: `DrawerProvider` recreated every open/close/toggle handler and the provider value object on each render. Because the provider wraps every authenticated route, this increased avoidable rerender churn for layout consumers.
- Fix:
  - Wrapped drawer/profile menu handlers in `useCallback`.
  - Memoized the context value with `useMemo`.
- Verification:
  - `npm.cmd --prefix apps/mobile run type-check`
  - Passed.

### 34. Production readiness gap closure - in progress 2026-05-18

Purpose:

- Close the P1/P2 readiness gaps found in the handoff-vs-BRD review before moving to new product scope.
- Keep each fix as a small TDD slice with red verification, green verification, and handoff update.

Slice 1 completed - cascade retry scheduling respects scheduled retry time:

- Gap: `CheckInsService.processCascadeAttempts` could send the next pending attempt immediately after a timeout or provider-send failure because `sendNextPendingAttempt` selected pending attempts using a far-future timestamp. This violated the BRD retry-staggering requirement for queued/scheduled retries.
- Fix: renamed the path to `sendNextDuePendingAttempt` and made it select only attempts due at the current processing time. If a future pending attempt exists, the check-in remains open instead of being marked `NEEDS_ATTENTION`.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/check-ins/check-ins.service.spec.ts`
  - Failed before fix because a future retry scheduled at `2026-04-27T06:15:00.000Z` was sent at `2026-04-27T06:00:00.000Z`.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/check-ins/check-ins.service.spec.ts`
  - Passed: 1 file, 11 tests.

Slice 2 completed - WhatsApp outbound requires Twilio Content Templates:

- Gap: the configured Twilio WhatsApp provider sent raw `Body` text through the Twilio Messages API, while the BRD requires approved Utility-category WhatsApp templates with quick-reply buttons.
- Fix:
  - `WhatsappProvider` now requires a `contentSidByTemplateKey` mapping and sends `ContentSid` plus `ContentVariables` instead of raw `Body`.
  - Missing Content SID mappings fail clearly before any Twilio request.
  - Added backend env placeholder `TWILIO_WHATSAPP_CONTENT_SIDS` for language-specific template mappings such as `consent_request:en` and `checkin_daily:en`.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/channels/configured-channel-providers.spec.ts`
  - Failed before fix because the request body contained `Body` instead of `ContentSid` / `ContentVariables`, and a missing mapping fell through to a Twilio request.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/channels/configured-channel-providers.spec.ts src/shared/config/app-config.service.spec.ts src/modules/channels/channel-providers.factory.spec.ts`
  - Passed: 3 files, 15 tests.

Slice 3 completed - voice caller-ID selection requires approved compliance:

- Gap: the voice caller-ID pool modeled compliance state, but `PrismaVoiceCallerIdRepository` selected sticky and new caller IDs using only `ACTIVE` status. An operationally active but not compliance-approved caller ID could be used for outbound Twilio calls.
- Fix: sticky caller-ID reuse and new caller-ID pool selection now require `complianceStatus: 'APPROVED'` in addition to `VoiceCallerIdStatus.ACTIVE`.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/check-ins/prisma-voice-caller-id.repository.spec.ts`
  - Failed before fix because sticky reuse and pool selection queries did not include `complianceStatus: 'APPROVED'`.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/check-ins/prisma-voice-caller-id.repository.spec.ts src/modules/check-ins/check-ins.service.spec.ts`
  - Passed: 2 files, 15 tests.

Slice 4 completed - escalation siren sound and sender voice fallback:

- Gap: escalation siren behavior was only a baseline. The backend and Android channel used the default notification sound, and the sender fallback voice path was not coded when push delivery reached zero devices.
- Fixes:
  - Backend escalation push payload now uses bundled sound `escalation-siren.wav`.
  - Mobile Android emergency channel now references `escalation-siren.wav`.
  - Added `apps/mobile/assets/sounds/escalation-siren.wav` and configured `expo-notifications` to bundle it.
  - `EscalationsService.notifySender` now places a Twilio/voice-provider fallback call to the sender when escalation push is not delivered or push sending fails.
  - `PrismaEscalationsRepository.findReceiverOwner` now returns the owner's encrypted phone so the fallback path can decrypt only at send time.
- Remaining explicit platform setup:
  - iOS Critical Alerts entitlement/authorization and Android DND-bypass onboarding/settings still require native/platform entitlement work and should not be claimed as granted behavior.
- Red verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/notifications/notifications.service.spec.ts src/modules/escalations/escalations.service.spec.ts`
  - Failed before fix because backend push still used `default` sound and no fallback voice call was made.
  - `npx.cmd vitest run apps/mobile/src/services/pushNotifications.spec.ts`
  - Failed before fix because the Android emergency channel still used `default` sound.
- Green verification:
  - `npm.cmd --prefix apps/backend test -- src/modules/notifications/notifications.service.spec.ts src/modules/escalations/escalations.service.spec.ts src/modules/escalations/prisma-escalations.repository.spec.ts`
  - Passed: 3 files, 17 tests.
  - `npx.cmd vitest run apps/mobile/src/services/pushNotifications.spec.ts`
  - Passed: 1 file, 1 test.

Full verification after slices 1-4:

- `npm.cmd --prefix apps/backend test`
  - Passed: 44 files, 217 tests.
- `npm.cmd --prefix apps/backend run type-check`
  - Passed.
- `npm.cmd --prefix apps/backend run build`
  - Passed.
- `npm.cmd --prefix apps/mobile run type-check`
  - Passed.
- `npx.cmd vitest run apps/mobile/src`
  - Passed: 10 files, 26 tests.
- `$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate`
  - Passed.
- Nest `AppModule` fake-provider bootstrap with RevenueCat webhook auth configured:
  - Passed: `app-context-ok`.

Android Studio / Expo Go QA update - 2026-05-18:

- Environment:
  - Android Studio launched from `C:\Program Files\Android\Android Studio\bin\studio64.exe`.
  - Emulator `Pixel_7` booted as `emulator-5554`.
  - Backend dev server running with local `.env`.
  - Mobile app running through Expo Go / Metro at `exp://192.168.1.211:8081`.
- Verified in emulator:
  - Login form loaded and accepted user sign-in.
  - Authenticated dashboard loaded with empty receiver state.
  - Drawer navigation opened and routed to Dashboard, Add receiver, Admin Operations, and Abuse Reports.
  - Admin Operations loaded backend health/status data for the signed-in super-admin account.
  - Abuse Reports loaded backend review state and empty pending queue.
  - Add Receiver form rendered receiver details, country/phone, relationship, channel, language, timezone, check-in window, note, and consent-send controls. Consent send was not submitted during QA to avoid sending real channel traffic.
  - Billing opened and showed App Store / Google Play subscription architecture with monthly, annual, and restore controls disabled when local RevenueCat SDK keys are absent.
- Issues found and closed during QA:
  - Expo Go crashed after sign-in because the push notification module used a dynamic runtime require that Metro did not include in the bundle. Fixed by using an async `import('expo-notifications')` and skipping Android push registration under Expo Go, where SDK 53+ does not support remote push notifications. Real development/store builds still load the RevenueCat/push native path.
  - Billing initially showed `Internal server error` because the connected Supabase test database had schema drift: the checked-in RevenueCat migration columns were missing from `subscriptions`. `prisma migrate deploy` could not run because the existing schema was not migration-baselined (`P3005`), so the checked-in RevenueCat billing DDL was applied idempotently to the test database. Billing then returned cleanly, leaving only the expected local `RevenueCat public API key is not configured for this platform` message.
- Verification after QA fix:
  - `npx.cmd vitest run apps/mobile/src/services/pushNotifications.spec.ts`
  - Passed: 1 file, 1 test.
  - `npm.cmd --prefix apps/mobile run type-check`
  - Passed.
  - `npx.cmd vitest run apps/mobile/src`
  - Passed: 10 files, 26 tests.

## First Command In A New Session

Read this file first:

```powershell
Get-Content -LiteralPath PROJECT_HANDOFF.md
```

Then check current state:

```powershell
git status --short --branch
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
```
