# Auth and accounts — feature handoff

Status: Partially built · Last verified: backend 2026-09-06 (specs; local token verification and the read-only sender path, PR #35); mobile auth flow 2026-05-18 (emulator, Pixel_7 via Expo Go)
BRD: §5.1 FR-AUTH-01..04 · Open backlog: CB-025, CB-028, CB-029, CB-033, CB-043, CB-044, CB-050

## What it does

- A sender signs up or signs in with email/password or Google/Apple through Supabase Auth; `SocialButton` on login and signup calls `signInGoogle` / `signInApple`.
- The backend verifies every Supabase access token locally (CB-024): signature against the project's published JWKS (ES256/RS256) or, when `SUPABASE_JWT_SECRET` is set and the token uses it, the legacy HS256 secret; then `exp` (30 s tolerance), `iss`, `aud` and `role`. The sender identity comes from the claims; no request to Supabase is made per API call.
- After a successful sign-in the app calls `POST /auth/sync-user`, the one route that upserts the encrypted sender row keyed by `authProviderId` (email, phone, country, language, timezone). The Supabase `user_metadata.full_name` (fallback `name`) is stored as the sender's display name — trimmed, inner whitespace collapsed, capped at 80 characters, AES-256-GCM in `users.displayNameEncrypted` — and is what receivers and backup contacts read as `senderDisplayName` (CB-010).
- Every other authenticated route reads the sender by `authProviderId` and writes nothing; a sender the app never synced is inserted once from the token claims so the request still works (CB-024).
- The session survives app restarts (AsyncStorage on native, browser `localStorage` on web); OAuth state lives in SecureStore on native; `familycheckin://` deep links route to the callback and reset-password screens.
- Sensitive actions (`EXPORT_DATA`, `DELETE_ACCOUNT`, `REMOVE_RECEIVER`) require an SMS OTP step-up that yields a single-use, action-bound token carried in `x-nearby-step-up-token`.
- Settings → Data & Privacy exports the account as JSON and deletes the account; deletion anonymises the user, receivers and backup contacts in one transaction and writes an audit event.
- Admin routes reuse the same Supabase token check, then require an active row in `admin_users` with an allowed role; admin rows are never auto-created from sender auth.
- Phone is never verified by OTP at signup (FR-AUTH-01 is unmet): it comes from `user_metadata.phone` written by the client. Biometric unlock is a stored preference only — nothing gates app entry on it.

## Where it lives

| Layer   | Paths                                                                                                                                                                                                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend | `apps/backend/src/modules/auth/`, `apps/backend/src/modules/users/`, `apps/backend/src/modules/account/`, `apps/backend/src/shared/auth/`                                                                                                                                                                     |
| Mobile  | `apps/mobile/src/services/{supabase,auth,auth-storage,biometric}.ts`, `apps/mobile/src/contexts/AuthContext.tsx`, `apps/mobile/src/hooks/{useAuth,useProfile}.ts`, `apps/mobile/src/components/auth/ProtectedRoute.tsx`, `apps/mobile/src/app/{_layout.tsx,index.tsx,(auth)/,auth/,(main)/settings/}`          |
| Data    | `users` (incl. `displayNameEncrypted`), `admin_users`, `step_up_challenges`; migrations `202604260001_initial_nearby_schema`, `202605010001_account_step_up`, `202605150001_receiver_remove_step_up`, `202609060202_users_display_name`                                                                        |
| Tests   | backend `auth.controller.spec.ts`, `supabase-auth.service.spec.ts`, `admin-auth.service.spec.ts`, `prisma-admin-users.repository.spec.ts`, `users.service.spec.ts`, `prisma-users.repository.spec.ts`, `account.controller.spec.ts`, `step-up.service.spec.ts`, `account-privacy.service.spec.ts`; mobile `auth.spec.ts`, `auth-storage.test.ts` |

## Routes and contracts

- `POST /auth/sync-user` — any Supabase-authenticated sender. Requires `Authorization: Bearer <supabase-access-token>`, verifies it locally (see Token verification below), upserts the sender through `UsersService.syncProfileFromSupabaseIdentity` (email, phone, country, language, timezone, and the display name when `user_metadata.full_name` or `name` is a non-blank string — a sync without one leaves the stored name untouched), returns only `user.id`, `country`, `preferredLanguage`, `timezone`. Missing/malformed bearer → 401; a missing or unparseable phone → 401 (`Supabase user is missing a phone number` / `phone number is invalid`); a phone or email already on another account → 409. `UsersService.senderDisplayNameFor(userId, fallback?)` is the read side used by the check-in, consent, lifecycle and escalation messages.
- Every other sender route (`/receivers`, `/backup-contacts`, `/billing`, `/notifications`, `/account`) resolves the sender with `UsersService.findOrCreateFromSupabaseIdentity`: one `users` read by `authProviderId`, zero writes for an existing row, one insert for a never-synced sender (a lost first-request race re-reads the winner's row). `upsertFromSupabaseIdentity` is kept as a deprecated alias of that read path because those controllers still spell it that way; renaming the call sites is a follow-up, not a behaviour change.

### Token verification (CB-024)

- `SupabaseAuthService.verifyAccessToken` (`apps/backend/src/modules/auth/supabase-auth.service.ts`, `jose` 5.10.0 pinned in `apps/backend`) decodes the JWS header and picks the scheme by `alg`: `HS256` needs `SUPABASE_JWT_SECRET` (401 naming the variable when it is unset); `ES256` / `RS256` are verified against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. Anything else (`none`, a non-JWT string) is 401 before any key is looked up.
- Claims: `exp` and `sub` required, 30 s clock tolerance; `iss` must equal `${SUPABASE_URL}/auth/v1`; `aud` and `role` must be `authenticated` (a service-role or anon key is 401); `email` required. Expired → `401 Supabase access token has expired`; every other token problem → `401 Invalid Supabase access token`.
- JWKS cache: fetched on first use (5 s timeout, concurrent first requests share one fetch), kept in memory, refreshed lazily after 10 minutes (a failed refresh keeps the stale set), refetched at most once per 30 s when a token carries an unknown `kid` (key rotation); a `kid` still unknown after that refetch is 401. A key set that cannot be fetched, is not 2xx, is not JSON or has no `keys` → 503, never 401.
- Identity from the claims: `sub` → `authProviderId`; `email`; phone from the `phone` claim (GoTrue's digits get their `+` back) else `user_metadata.phone`, absent when neither exists — `UsersService` requires it only when it writes a row; `country` must be two letters (upper-cased) else `AE`; `preferred_language` lower-cased, BCP 47-shaped, at most 8 characters, else `en`; `timezone` must be an IANA zone the platform evaluates (`isSupportedTimeZone`) else `Asia/Dubai`. Garbage metadata can no longer produce a 500.
- Which scheme a project uses: Supabase dashboard → Project Settings → JWT Keys. A project whose current key is ECC (P-256) or RSA needs nothing set; a project still on the legacy shared secret shows it under "Legacy JWT Secret" — copy it into `SUPABASE_JWT_SECRET`. During a migration to asymmetric keys both schemes work at once: HS256 tokens still verify with the secret while new ES256 tokens verify through the JWKS.
- `GET /auth/admin/me` — active admin only. Returns only `admin.id` and `admin.role`; no email, encrypted email or email hash. Inactive or unlisted → 403.
- `POST /account/step-up/request` — authenticated sender. Body `{ action }` limited to `EXPORT_DATA | DELETE_ACCOUNT | REMOVE_RECEIVER`; sends a 6-digit OTP over SMS via the channel router; returns `challengeId`, `action`, `expiresAt` (10 min).
- `POST /account/step-up/verify` — authenticated sender. Body `{ challengeId, code }`; returns `stepUpToken` and `expiresAt` (10 min). Wrong code increments the attempt counter; 5 attempts lock the challenge.
- `GET /account/export` — authenticated sender plus `x-nearby-step-up-token` for `EXPORT_DATA`. Returns the decrypted account export (`exportVersion: '2026-05-01'`) covering user (with `displayName` when stored), receivers, backup contacts, check-ins, attempts, escalations, subscriptions, audit logs.
- `DELETE /account` — authenticated sender plus `x-nearby-step-up-token` for `DELETE_ACCOUNT`. Anonymises (email, phone, hashes and the display name, which is set to NULL) and audits; returns `{ ok: true, deletedAt }`. Reads `x-forwarded-for` and `user-agent` for the audit record.
- Mobile routes this feature owns: `/(auth)/welcome`, `/(auth)/login`, `/(auth)/signup`, `/(auth)/forgot-password`, `/(auth)/onboarding`, `/auth/callback`, `/auth/reset-password`, `/(main)/settings/profile`, `/(main)/settings/data-privacy`, `/(main)/settings/security`. `/index` is the splash that routes to `/(main)` or `/(auth)/welcome` once auth state resolves.

## How to exercise it locally (fake mode)

- Follow `docs/EMULATOR_RUNBOOK.md` §2–§4. Backend needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` (`SUPABASE_SERVICE_ROLE_KEY` is optional and never read — CB-025, #36; founder decision 2026-09-06: the backend never uses the service-role key or the Supabase admin API, security is RLS plus the backend's own database connection), plus `SUPABASE_JWT_SECRET` only when the project signs with the legacy HS256 secret (see Token verification); mobile needs `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_BACKEND_URL`.
- With the backend on `SUPABASE_URL` and no secret, the first authenticated request logs nothing but fetches the JWKS once; every later request is verified in memory. A token from a different Supabase project (wrong `iss`) or an expired one is 401; stop the network and restart the backend to see the 503 on a cold JWKS cache.
- Sign in through Expo Go with a real Supabase test user. The dashboard loading receivers is the proof that `getSession()` returned a token and the backend accepted it; a blank dashboard with 401s means session persistence broke.
- Negative check: `POST http://localhost:3000/auth/sync-user` with no `Authorization` header must return 401.
- The step-up OTP is readable in fake mode: the SMS body prints in the backend terminal as a `[fake-provider]` line and is returned by `GET /receiver-replies/fake/outbound` (cron-secret bearer), so export, delete and remove-receiver can be driven end to end from the app. `step_up_challenges` itself stores only `codeHash`.
- Specs: `npm.cmd --prefix apps/backend test -- src/modules/auth src/modules/users src/modules/account`; `npx.cmd vitest run apps/mobile/src/services/auth.spec.ts apps/mobile/src/services/auth-storage.test.ts`.

## Invariants — do not break

The mobile auth setup took significant effort and must not be casually rewritten. Protected files whose behavior must be preserved:

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

Further invariants the code now relies on:

- `apps/mobile/src/services/auth-storage.ts` (with `auth-storage.test.ts`) owns the native/web storage split. The split keys off `Platform.OS === 'web'`, never off `typeof window`: React Native exposes `window`, and the old check routed Android sessions to unavailable `localStorage`.
- `isAllowedAuthRedirect` in `supabase.ts` accepts only scheme `familycheckin` with path `auth/callback` or `auth/reset-password`. Widening it widens the OAuth attack surface.
- Supabase client options stay `flowType: 'pkce'`, `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: false`.
- The app never reads Supabase tables directly; all product data goes through the backend REST client in `backendApi.ts`, which attaches `Authorization: Bearer ${session.access_token}`.
- Step-up tokens are hashed at rest, single-use, action-bound and 10-minute TTL; `exportAccount`/`deleteAccount` consume the token before touching data.
- `AccountModule` must keep exporting `StepUpService` and `ReceiversModule` must keep importing `AccountModule`: the receiver-remove step-up consumes its token through `ReceiversController`'s `@Optional()` dependency, and when it was unresolvable every removal was a 403 while the unit spec stayed green (CB-070). `app.module.spec.ts` asserts the injection.
- `AdminAuthService` never auto-creates admin rows from sender auth and never selects admin email, encrypted email or email hash.
- Token verification is local: no route may call `${SUPABASE_URL}/auth/v1/user` (or any Supabase endpoint) per request again. The JWKS fetch is the only network call and happens only on a cold cache, after the 10-minute max age or once per 30 s for an unknown `kid`; `SUPABASE_JWT_SECRET` is optional and only for HS256 projects (CB-024).
- Only `POST /auth/sync-user` writes profile columns (`UsersService.syncProfileFromSupabaseIdentity` → `upsertSenderByAuthProviderId`). Every other route resolves the sender through `findOrCreateFromSupabaseIdentity` (one read; an insert only when no row exists) — never reintroduce a per-request upsert, and keep `upsertFromSupabaseIdentity` an alias of the read path until its call sites are renamed (CB-024).
- Missing or malformed token metadata never produces a 500: `country`, `preferred_language` and `timezone` fall back to `AE` / `en` / `Asia/Dubai`; a phone is required only when a row is written, and then a missing or unparseable one is 401, a duplicate 409.
- Sender email and phone are encrypted (AES-256-GCM) with a separate deterministic hash for lookup; the display name is encrypted the same way (no hash — it is never looked up by value); no raw PII, the display name included, goes into audit metadata.
- `findDisplayNameEncryptedById` reads live senders only (`deletedAt: null`), so a deleted sender's receivers, if any survived, read the neutral wording; account deletion also nulls the column.
- `Credentials.xlsx` in the repo root must not be read unless the user explicitly asks for it.

## Known gaps

- CB-044 (auth-user deletion) must not reach for the Supabase admin API with the service-role key (founder decision 2026-09-06, see CB-025); it needs a route that works through the user's own session.
- The controllers outside the CB-024 change (`receivers`, `backup-contacts`, `billing`, `notifications`, `account`) still call `usersService.upsertFromSupabaseIdentity` (rename tracked as CB-084), which is now the read-or-insert path under its old name; rename the calls to `findOrCreateFromSupabaseIdentity` when those files are next touched and delete the alias.
- A revoked Supabase session stays valid until its access token expires (Supabase's default is one hour): local verification cannot see server-side sign-outs. A per-request revocation check would reintroduce the network hop; accept it or shorten the project's JWT expiry.
- CB-028 — the custom OAuth `state` expectation rejects Google/Apple callbacks with "Invalid authentication state"; GoTrue does not echo a client `state` on the PKCE `?code=` redirect.
- CB-029 — deep links are processed twice (root layout and the callback screen); no "check your email" state after signup; reset-password warm start fails.
- CB-033 — the profile form is seeded before load, phone is read from the empty `authUser.phone`, Save blanks `full_name` (a blank `full_name` is ignored by `sync-user`, so the stored display name survives that bug but cannot be changed from the app until it is fixed), and "Change photo" is dead.
- CB-043 — the sender phone is trusted from client-writable `user_metadata.phone` at the first insert and on every `POST /auth/sync-user` (no longer on every request since CB-024); the step-up OTP and siren call follow it.
- CB-044 — a soft-deleted user's token is still accepted: the anonymised row is read back as the sender (it is no longer rewritten per request since CB-024); the Supabase auth user is never deleted; device tokens and subscriptions survive.
- CB-050 — non-atomic step-up attempt counter, no per-user OTP cap (SMS pumping), token consume race.
- Already solid, do not redo (`docs/COMPLETION_BACKLOG.md` lines 136–150): the step-up design itself — hashed OTP and token, 10-minute TTLs, 5-attempt lock, single-use, action-bound.

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` — Protected Auth Boundary (lines 44–83), Backend Foundation (lines 184–700, auth/users services and the 2026-04-27 `@Inject` DI fix), §10 Android auth/session persistence fix (lines 1468–1497), §23 admin auth foundation (lines 1917–1963), §29d account data privacy and step-up (lines 2364–2383), §29f stale-surface cleanup (lines 2439–2476), §34 Android Studio / Expo Go QA (lines 3440–3472).
- PRs: none of the sprint-1 PRs recorded in the archive (#17–#20) touch this feature; the auth and account work predates them. #24 (CB-070: `StepUpService` exported to `ReceiversModule`; emulator acceptance report). #31 (CB-010: `users.displayNameEncrypted` stored by `sync-user`, `UsersService.senderDisplayNameFor`, export and deletion cover the name). #35 (CB-024: local JWT verification with `jose`, JWKS cache, `SUPABASE_JWT_SECRET`, read-only sender resolution outside `sync-user`, metadata fallbacks, 401/409/503 mapping).
- Emulator acceptance 2026-09-06 (`docs/audits/2026-09-06/emulator-acceptance.md`): login, export with OTP and remove-receiver with OTP verified on the device; profile screen gaps (CB-033) confirmed.
