# Nearby Project Handoff

Last updated: 2026-04-29

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

Project git workflow:

- This is a solo project; commit directly to `master` unless the user explicitly asks for a separate branch.
- After completing a task and updating this handoff, commit the intended changes and push `master` to GitHub.
- Still inspect `git status`, avoid committing ignored/local secret files, and keep generated `apps/backend/dist` out of source control.

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
- Signed in manually through the native login screen after correcting an adb text-entry issue where the password initially became `Iloveyou123@g`.
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
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
```

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
  - `TWILIO_AUTH_TOKEN`
  - `PUBLIC_API_BASE_URL`
- Added design and implementation plan:
  - `docs/superpowers/specs/2026-05-01-provider-webhooks-design.md`
  - `docs/superpowers/plans/2026-05-01-provider-webhooks.md`

Files changed for this slice:

- `apps/backend/src/modules/provider-webhooks/provider-webhooks.controller.ts`
- `apps/backend/src/modules/provider-webhooks/provider-webhooks.controller.spec.ts`
- `apps/backend/src/modules/provider-webhooks/provider-webhooks.module.ts`
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
```

Full backend verification:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Backend full suite passed: 35 files, 153 tests.

`apps/backend/dist` was removed after build verification.

### 29b. Next Planned Slice

Harden and expand provider integration after the adapter endpoints:

- Add vendor-specific signature verification:
  - Meta WhatsApp app secret signature validation
  - selected SMS provider signature validation after vendor selection
- Add WhatsApp GET verification challenge endpoint if using Meta direct webhooks.
- Add delivery/status webhook handling only if product or ops workflows need it.
- Add voice webhook handling after voice provider selection.

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

### 31. Later, after local fake flow is proven

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
