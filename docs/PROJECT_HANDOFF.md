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
- `README.md` has been refreshed for the Nearby direction as of 2026-04-27. It no longer describes the old Family Check-In scope.

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
- SecureStore auth persistence on native
- Browser `localStorage` auth persistence on web smoke tests
- OAuth state handling
- Deep-link callback and reset-password routing
- `familycheckin` URL scheme
- Existing auth screens unless explicitly approved

Auth-sensitive note from 2026-04-26:

- `apps/mobile/src/services/supabase.ts` was minimally updated so the storage adapter uses Expo SecureStore on native and browser `localStorage` on web.
- This fixed Expo web auth smoke testing, where `expo-secure-store` threw `getValueWithKeyAsync is not a function`.
- Native Supabase Auth flow, deep-link handling, OAuth state validation, and reset-password logic were not rewritten.

Before and after auth-sensitive work, inspect diffs carefully.

## Supabase Status

Supabase project ref:

- `nrohtflgytywovwabvdo`

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
- Applied the patch to Supabase project `nrohtflgytywovwabvdo` using the backend `DATABASE_URL`.
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
  - `configured` for real provider adapters
- `SMS_PROVIDER_API_KEY`
- `SMS_PROVIDER_FROM_NUMBER`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `VOICE_PROVIDER_API_KEY`
- `VOICE_PROVIDER_FROM_NUMBER`
- These are documented in `apps/backend/.env.example`.
- `.gitignore` now explicitly ignores common provider credential/secret dump file patterns in addition to existing `.env` protection.
- Prisma 7 runtime uses `@prisma/adapter-pg` in `PrismaService`, passing `AppConfigService.databaseUrl` explicitly.

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
Invoke-RestMethod -Method Post -Uri http://localhost:3000/receiver-replies/fake -ContentType 'application/json' -Body '{"fromPhone":"+971501234567","channel":"WHATSAPP","body":"YES","providerMessageId":"local-consent-1"}'
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
  - phone `+971501234894`
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

### 6. Next Planned Slice

Implement the receiver `Remove` flow as a soft delete:

- Backend:
  - add authenticated `DELETE /receivers/:receiverId`
  - verify Supabase bearer token and sync sender profile
  - scope soft delete by `userId + receiverId + deletedAt: null`
  - set `deletedAt` instead of hard-deleting rows
  - return `404` when missing or not owned
  - append `receiver.deleted` audit event with safe metadata only
  - ensure deleted receivers disappear from `GET /receivers` and `GET /receivers/:receiverId`
- Expo:
  - wire receiver detail `Remove` button
  - show a confirmation prompt before deleting
  - call backend delete endpoint
  - navigate back to dashboard/list after success
  - keep pause/edit state unaffected
- Verification:
  - TDD red/green backend controller, service, and Prisma repository tests
  - backend full test suite
  - backend type-check
  - mobile type-check
  - browser smoke test from receiver detail
  - update this handoff after completion

### 7. Later, after local fake flow is proven

- Real WhatsApp/SMS/Voice webhook adapter controllers.
- Real provider implementations after vendor selection.
- Backup contacts and escalation cascade.
- Payments/tier gating.
- Admin panel for abuse reports and operational monitoring.
- Rotate the Supabase access token and DB password pasted in chat.

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
