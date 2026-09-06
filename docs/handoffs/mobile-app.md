# Mobile app shell (Nearby sender app) — feature handoff

Status: Partially built · Last verified: 2026-09-06 (emulator Pixel_7 via Expo Go, full runbook: login, add receiver, receiver detail, backup contact, sender actions, admin screens, Data & Privacy export and remove-receiver step-ups; `docs/audits/2026-09-06/emulator-acceptance.md`). The sprint-2 wave-B detail/dashboard changes (resend invitation, resolution note, backup-alert outcome, schedule-attention chip, typed error copy) and the sprint-3 changes (resend-window button state, `backendRequest` transport hardening) are verified by type-check, lint and the vitest project only; emulator pass pending.
BRD: FR-DSB-01/02/04, FR-AUTH-02, FR-CHN-03c, FR-LNG-01 · Open backlog: CB-027 … CB-041, CB-066, CB-078

## What it does

- Expo SDK 54 / React Native 0.81 / Expo Router 6 app for the **sender**. Receivers never install it; they answer over WhatsApp/SMS/voice.
- Boots to a splash route that redirects to `/(auth)/welcome` or `/(main)` from the Supabase session.
- Authenticated shell is a fixed `Header` + left `Sidebar` drawer (Dashboard, Add receiver, Admin Operations, Abuse Reports) + right `ProfileMenu` (Profile, Billing, Appearance, Language, Security, Data & Privacy, Log out).
- Talks to the NestJS backend through one client (`services/backendApi.ts`) with a Supabase bearer token; no direct Supabase table reads remain on the receiver/check-in path.
- Handles password-reset and OAuth/email-confirmation deep links on the `familycheckin://` scheme.
- Registers an Expo push token after sign-in, except on web and Android/Expo Go.

## Where it lives

| Layer       | Paths                                                                                   |
| ----------- | --------------------------------------------------------------------------------------- |
| Routes      | `apps/mobile/src/app/` (Expo Router root, set in `app.json` → `plugins.expo-router.root`) |
| Shell       | `apps/mobile/src/components/layout/` (`Header`, `Sidebar`, `ProfileMenu`), `contexts/DrawerContext.tsx` |
| Auth state  | `apps/mobile/src/contexts/AuthContext.tsx`, `components/auth/ProtectedRoute.tsx`          |
| API client  | `apps/mobile/src/services/backendApi.ts`, `services/backendErrors.ts`                     |
| Services    | `services/userData.ts`, `biometric.ts`, `pushNotifications.ts`, `revenueCat.ts`, `supabase.ts` |
| Utils       | `apps/mobile/src/utils/` — pure, vitest-covered: `receiverStatus.ts` (status chip, schedule-attention chip), `receiverActions.ts` (action notices, resolution-note check), `adminOperations.ts`, `checkInSkipReason.ts`, `channelProfiles.ts`, `timeOptions.ts`, `timezoneOffset.ts` |
| Theme       | `apps/mobile/src/theme/` (`colors.ts`, `spacing.ts`) — static tokens, light only          |
| Config      | `apps/mobile/app.json`, `metro.config.js`, `eas.json`, `.env.example`, `package.json`     |
| Tests       | `apps/mobile/src/**/*.spec.ts` (vitest project `mobile`, node environment)                |

## Routes and contracts

Backend endpoints this app calls are all declared in `services/backendApi.ts`; they belong to the receivers, admin, billing and account handoffs in `docs/handoffs/`.

| Route                              | Purpose                                                        | Reachable?                                         |
| ---------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| `/` (`app/index.tsx`)              | Splash; redirects on auth state after ~800 ms                   | app entry                                           |
| `/(auth)/welcome`                  | Unauthenticated landing, Log in / Sign up                       | from splash and after sign-out                      |
| `/(auth)/login`                    | Email/password + social sign-in                                 | from welcome                                        |
| `/(auth)/signup`                   | Account creation                                                | from welcome, from login                            |
| `/(auth)/forgot-password`          | Password reset request                                          | from login                                          |
| `/(auth)/onboarding`               | Sender onboarding wizard                                        | `router.replace('/onboarding')` from login/signup, but `ProtectedRoute` bounces authenticated users out of `(auth)` → effectively not reachable |
| `/auth/callback`                   | OAuth / email-confirmation landing                              | from the root deep-link handler                     |
| `/auth/reset-password`             | Sets a new password from a recovery link                        | from the root deep-link handler                     |
| `/(main)`                          | Dashboard: receiver cards, statuses, quick actions; refetches on focus, pull-to-refresh kept; a "Schedule needs attention" chip on cards whose `scheduleInvalidAt` is set (CB-069) | drawer                                              |
| `/(main)/receiver-setup`           | Add-receiver form (name, phone, channel, schedule, consent send); quarter-hour window pickers, live UTC offsets; typed 409 refusals explained (`describeBackendError`); a create whose consent send failed opens the detail with `consentRequest=failed` | drawer, and from dashboard empty state / quick action|
| `/(main)/receivers/[id]`           | Receiver detail: status, schedule, channels, backup contacts, pause/resume/edit/remove; refetches on focus; a 404 shows "This receiver was removed" and returns to the dashboard; "Resend invitation" while consent is PENDING, disabled with "Resend available <local date time>" until `consentResendAllowedAt` (CB-081); optional ≤200-char note on Mark resolved and the stored note; in-screen notice with the backup-alert outcome; schedule warning that opens Edit; typed 409/429 copy | from dashboard cards, from receiver-setup after a failed consent send |
| `/(main)/admin-operations`         | Check-in operations summary                                     | drawer (shown to every user — CB-039)               |
| `/(main)/admin-operations/[checkInId]` | Per-check-in attempts and escalations                       | from admin-operations rows                          |
| `/(main)/admin-abuse-reports`      | Abuse-report review queue                                       | drawer (shown to every user — CB-039)               |
| `/(main)/settings/profile`         | Name/phone profile form                                         | profile menu                                        |
| `/(main)/settings/billing`         | RevenueCat plans, purchase, restore                             | profile menu, and an onboarding alert               |
| `/(main)/settings/appearance`      | Theme picker — local `useState` only, nothing applied           | profile menu (decoy — CB-034)                       |
| `/(main)/settings/language`        | Language picker — local `useState` only, nothing applied        | profile menu (decoy — CB-034)                       |
| `/(main)/settings/security`        | Biometric enable/disable toggle                                 | profile menu                                        |
| `/(main)/settings/data-privacy`    | Step-up export and account deletion                             | profile menu                                        |
| `/(main)/check-ins`, `/escalations`, `/loved-ones`, `/pairing` | `<Redirect href="/(main)" />` stubs         | not linked (legacy) — CB-066                        |
| `app/(app)/`                       | Empty directory, no route files                                 | not linked (legacy)                                 |
| `_layout.tsx` × 5 (root, `(auth)`, `auth`, `(main)`, `(main)/settings`) | Stacks; root adds `AuthProvider` + `ProtectedRoute` + deep links; `(main)` adds `DrawerProvider`, `Header`, `Sidebar`, `ProfileMenu` | n/a |

## How to exercise it locally (fake mode)

- Follow `docs/EMULATOR_RUNBOOK.md` §3 for the backend, then §4 for the app.
- `apps/mobile/.env` (see `.env.example`): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_BACKEND_URL`, and optionally `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID` (defaults to `nearby_access`).
- Emulator: `npm run android` at the repo root (proxies to `npm --prefix apps/mobile run android` → `expo start --android`). Web: `npm --prefix apps/mobile run web`.
- Pin the port when 8081 is busy: `npm --prefix apps/mobile run android -- --port 8082`.
- Checks: `npm --prefix apps/mobile run type-check`, `npm --prefix apps/mobile run lint`, `npm test` at the root (runs the `mobile` vitest project; also `npx vitest run --project mobile`). Type-check and the `mobile` project pass as of 2026-09-06.
- Metro port drift: Expo falls back to 8082/8083 when 8081 is taken. The backend CORS allow-list matches `http://localhost:80xx` and `http://127.0.0.1:80xx`, so requests still succeed, but Expo **web** storage is per-origin — a new port means a signed-out browser session and a fresh login.

## Invariants — do not break

- `backendRequest` in `services/backendApi.ts` is the only path to the backend. It requires a Supabase access token (throws `You need to sign in again` without one), sends `Authorization: Bearer <token>`, reads the body as text, and on a non-2xx throws `BackendRequestError(message, status, code, details)` built from `message` → `error` → a status fallback; `details` is every other field of the error body (`cooldownUntil`, `nextAllowedAt`, …), `{}` when the body is not JSON. A 2xx whose body is empty or not JSON throws `BackendTransportError` with a plain sentence (`EMPTY_RESPONSE_MESSAGE` / `UNREADABLE_RESPONSE_MESSAGE`), never a raw parse error; GET/HEAD are re-sent once after that or after a dropped connection (`TypeError`), state-changing requests never (CB-080). `deleteReceiver` and `deleteBackupContact` pass `acceptEmptyBody` (the status line proves the server acted); `exportAccountData` passes `retry: false` because its step-up token is single-use. Screens branch on `isPaidAccessRequiredError` (403 + `PAID_ACCESS_REQUIRED`) for the paywall and show every other failure through `describeBackendError(error, fallback)` in `services/backendErrors.ts`, which maps `OPT_OUT_COOLDOWN`, `RECEIVER_ALREADY_MONITORED`, `CHECK_IN_IN_PROGRESS`, `CONSENT_NOT_PENDING` and `CONSENT_RESEND_LIMIT` to a sentence carrying the date from `details`, and falls back to the backend message, then to `fallback`.
- Receiver-detail action outcomes are in-screen notices (`ActionNotice` from `utils/receiverActions.ts`), never blocking alerts: the backup-alert result (`backupAlertNotice`), the resend result (`consentResendNotice`), the resolve confirmation, and the failed-consent hand-off from the add form (`CONSENT_REQUEST_FAILED_NOTICE`, seeded from the `consentRequest=failed` route param). `handleActionError` reloads the detail on a 404 and on 409 `CONSENT_NOT_PENDING` before showing the message.
- `alertBackupForReceiverCheckIn` returns `{ receiver, backupAlert }`; `resolveReceiverCheckIn(receiverId, checkInId, note?)` sends `{ note }` only when the trimmed note is non-empty, after `normalizeResolutionNote` has refused anything over 200 code points; `resendReceiverConsent` posts to `/receivers/:id/consent/resend`.
- `scheduleInvalidAt` renders as a separate warning (`getScheduleAttentionDisplay` in `utils/receiverStatus.ts`): a chip on the dashboard card, a panel with "Edit schedule" on the detail. It never replaces the consent/check-in status chip.
- The Android host rewrite lives only in `resolveBackendUrl()`: `://localhost:` and `://127.0.0.1:` become `://10.0.2.2:` when `Platform.OS === 'android'`. Keep `.env` on `localhost` so iOS/web keep working; do not hardcode `10.0.2.2`.
- `EXPO_PUBLIC_*` values are inlined at bundle time — changing `.env` needs a Metro restart, not a reload.
- `pushNotifications.ts` must keep loading `expo-notifications` through `await import()` and must keep the `Platform.OS === 'android' && Constants.appOwnership === 'expo'` early return. A static or `require()` import crashed Expo Go after sign-in (SDK 53+ dropped remote push in Expo Go). `AuthContext` likewise dynamic-imports the module only once `session.user` exists.
- RevenueCat is a no-op without a native build: `revenueCatAvailability()` returns unconfigured on web or with no platform key, and `loadPurchases()` returning null yields "RevenueCat native module is unavailable. Use a development or store build." Purchase/restore controls stay disabled — expected in Expo Go.
- `Sidebar` and `ProfileMenu` render outside the `(main)` `Stack` so the drawers survive route changes; `DrawerContext` handlers stay wrapped in `useCallback`/`useMemo` because the provider wraps every authenticated route.
- `ProtectedRoute` redirects authenticated users out of `(auth)` and unauthenticated users out of `(main)`. Adding an authenticated screen under `(auth)` makes it unreachable.
- Screens refetch on focus. `useReceivers` (dashboard) and the receiver detail load inside `useFocusEffect` from `expo-router` — first mount and every return to the screen — and keep pull-to-refresh. `loading` blanks the screen only before the first successful load; later refetches leave the current content visible. `useReceivers` therefore has to be called from a screen inside a navigator.
- A receiver-detail action that returns 404 reloads the receiver: if the receiver itself is gone, the screen says "This receiver was removed" and `router.replace('/(main)')`; otherwise it shows the message on a refreshed detail (`isNotFoundError` in `services/backendErrors.ts`).
- Status labels: a SKIPPED check-in reads "Skipped" unless a skip reason is known (`utils/checkInSkipReason.ts`); "No backup available" is reserved for the `no_backup_contacts` reason, which no payload carries yet (CB-077 note in `docs/handoffs/admin-operations.md`). Consent and pause still win over the latest check-in.
- Pickers: `TimeSelect` lists quarter-hour steps by default (`utils/timeOptions.ts`, 96 rows) and keeps a loaded off-step value in the list; `TimezoneSelect` computes the UTC offset from the IANA zone at render time (`utils/timezoneOffset.ts`), so the static `offset` in `data/timezones.ts` is only the fallback when Intl cannot format the zone.
- `ReceiverPhoneInput` takes a `label` (default "Receiver phone"); the sign-up form passes "Your phone number" and the backup-contact form "Backup contact phone". The sign-up error banner clears when any field changes.
- Screens import from specific modules (`services/backendApi`, `services/userData`, `data/countries`, …), never the `services`/`data` barrels — the barrels pull native-facing code into route bundles.
- `metro.config.js` sets `watchFolders` to the workspace root, adds both `node_modules` paths, and sets `disableHierarchicalLookup = true`; this is what lets Metro resolve `expo-router/entry-classic` in the npm-workspaces monorepo.
- `biometric.ts` guards every call with `isWebRuntime` and stores only `biometric_enabled` / `biometric_user_id` in SecureStore; it does not gate any login path.
- `userData.ts` requires a step-up token for both `GET /account/export` and `DELETE /account`, and signs out locally after a successful delete.
- `eas.json` is not build-ready: `env` blocks use `${VAR}` interpolation EAS does not expand, no profile carries `EXPO_PUBLIC_BACKEND_URL` or RevenueCat keys, `app.json` `extra.eas.projectId` is empty, `submit.production.android.serviceAccountKeyPath` points at `./google-services.json`, and there is no `versionCode`/`buildNumber`.

## Known gaps

- CB-027 — `eas.json`/`app.json` not store-buildable: `${VAR}` env interpolation, empty `projectId`, wrong submit key path, no `versionCode`/`buildNumber`.
- CB-028 — Google/Apple sign-in rejects every callback with "Invalid authentication state" (custom `state` check).
- CB-029 — Deep links processed twice (root layout + callback screen); no "check your email" state after signup; reset-password warm start fails.
- CB-030 — Push: no foreground handler, no tap → deep link, tokens never unregistered on sign-out, no Time-Sensitive entitlement.
- CB-031 — Android push impossible: no FCM `googleServicesFile`, no DND detection or guidance.
- CB-032 — Dashboard swallows API errors (401/network renders "No receivers yet"); "Review receivers" quick action is a no-op.
- CB-033 — Profile form seeded before load, phone read from an empty `authUser.phone`, Save blanks `full_name`, dead "Change photo".
- CB-034 — Appearance, Language and the biometric toggle are placeholders; Terms/Privacy point at an unowned domain.
- CB-035 — No "Test my siren" control and no DND/critical-alert status.
- CB-036 — Receiver detail lacks 30-day history, escalation list and time-since-last-contact; pause has no end-date picker.
- CB-037 — `backendRequest` has no timeout, no 401 handling, raw Nest text on 429, and refresh timers stall in background.
- CB-038 — Siren asset is a 0.35 s, 8 kHz mono blip.
- CB-039 — Admin drawer items are shown to every user; non-admins get a 403 screen.
- CB-040 — expo-doctor 15/18: hoisted duplicate `react`/`react-native`, patch mismatches, metro overrides.
- CB-041 — Billing: no post-purchase polling, `configure()` on user switch, wrong `userData.ts` export type keys.
- CB-066 — Stale artefacts including the four mobile legacy redirect stubs, the "Family Check-In" splash/app name and the export filename.
- CB-078 — PKCE downgrades to `plain` in Expo Go (no WebCrypto); a dev build needs a crypto polyfill.
- CB-080 — code done (#34); device re-check pending: the next emulator pass must repeat the ten consecutive detail loads and the two remove flows from the sprint-2 run and see no parse error.
- CB-082 — the lazily imported `expo-notifications` chunk failed to parse once in Expo Go (sprint-2 acceptance F4).

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` §4 (lines 885–927, first Expo web smoke and the `receiver-setup` route fix), §5 (lines 928–1179, replacing the Supabase loved-one screens with backend receiver reads), §9 (lines 1400–1420, Android `10.0.2.2` rewrite and the `80xx` CORS pattern), §33 (lines 3340–3365, import splitting and drawer memoisation), Android Studio / Expo Go QA (lines 3440–3472, the Expo Go push crash fix). Known Issues at lines 766–779 record the still-open Expo web warnings: nested `auth/callback` and `auth/reset-password` route-name warnings, `Unexpected text node` on auth screens, and deprecated `shadow*` style props.
- Feature detail lives in the auth, receivers, admin-operations and billing handoffs in `docs/handoffs/`.
- Sprint 2 mobile findings from the emulator run (CB-071 focus refetch and removed-receiver feedback, CB-072 phone labels and sign-up banner, CB-073 quarter-hour pickers and live offsets, CB-077 skipped-status labels): PR #25.
- Sprint 2 wave B receivers app follow-ups (CB-074 backup-alert outcome notice, CB-069 schedule-attention chip and detail warning, resend invitation, resolution note, `describeBackendError` copy, `BackendRequestError.details`, failed-consent hand-off from the add form): PR #30.
- Sprint 3 (CB-081 resend-window button state from `consentResendAllowedAt`; CB-080 `backendRequest` reads text, `BackendTransportError`, one GET retry, empty-body-tolerant deletes): PR #34.
