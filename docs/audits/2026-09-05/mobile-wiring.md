# Mobile wiring audit (apps/mobile, Expo SDK 54) - 2026-09-05

Scope: every route under `apps/mobile/src/app`, every backend call in `src/services/backendApi.ts`, Supabase auth boundary, push, billing, build config. Read-only. Backend compared against `apps/backend/src/modules/*/*.controller.ts` on branch `codex/production-readiness-gaps` (HEAD 3cb438b; mobile tree is clean).

## 1. Executive summary

**Verdict: the core sender loop (sign in with email -> add receiver -> receiver detail -> backup contacts -> check-in actions -> step-up delete/export -> admin screens) is genuinely wired end to end and the REST contract matches the backend almost field-for-field. It would work on a device against a hosted backend for an email/password user with a phone in Supabase metadata. It is NOT store-buildable as committed, social login is very likely broken, push will never register, and four settings screens are placeholders.**

Top blockers (ordered by impact):

1. **`eas.json` uses `${EXPO_PUBLIC_SUPABASE_URL}` interpolation, which EAS does not support** (`apps/mobile/eas.json:15-18,26-29,35-38`). Every EAS build bakes the literal string in; `supabase.ts:13` then throws or the client points at `${...}`. `EXPO_PUBLIC_BACKEND_URL` and RevenueCat keys are in no build profile at all -> `backendApi.ts:510` throws "Missing EXPO_PUBLIC_BACKEND_URL" on every call.
2. **`extra.eas.projectId` is empty** (`app.json:83`). `eas build` cannot run non-interactively and `getExpoPushTokenAsync()` (`pushNotifications.ts:66`) throws in any dev/store build -> push registration silently never happens (error only `console.warn`ed at `AuthContext.tsx:71`).
3. **Native Google/Apple sign-in almost certainly fails with "Invalid authentication state".** `auth.ts:121-125,181` sends a custom `state` to Supabase; GoTrue generates its own state and does not echo the client one back on the `familycheckin://auth/callback?code=...` redirect, so `supabase.ts:106-111` rejects every OAuth completion. `auth.spec.ts:83-113` mocks `handleAuthDeepLink`, so tests cannot catch this.
4. **Sender phone is stored only in `user_metadata.phone`** (`auth.ts:38-44,66-71`), but Profile reads `authUser.phone` (`useProfile.ts:50`) and saves via `supabase.auth.updateUser({ phone })` (`useProfile.ts:69-70`), which needs the Supabase phone/SMS provider. Backend rejects any user without metadata phone with 401 (`supabase-auth.service.ts:58-61`) and the app offers no recovery path.
5. **Android push cannot obtain a token**: no `android.googleServicesFile` / `google-services.json` in `app.json`; FCM is required for Expo push on Android builds.
6. **No foreground notification handler and no tap handler** (`setNotificationHandler`/`addNotificationResponseReceivedListener` never called; grep = only the type at `pushNotifications.ts:23`). On iOS an escalation push arriving while the app is open shows nothing; `data.deepLink` sent by `notifications.service.ts:108` is ignored.
7. **Device tokens are never unregistered on sign-out** (`ProfileMenu.tsx:42-46`, `userData.ts:69`; backend has no DELETE `/device-tokens`). A shared device keeps receiving the previous user's escalation sirens.
8. **Dashboard swallows API errors**: `useReceivers` sets `error` but `index.tsx:12,65-89` never reads it, so a 401/network failure renders "No receivers yet".
9. **Profile form never populates**: `profile.tsx:14-15` seeds `useState` from a profile that is still `null`; once loaded, `hasChanges` is true with an empty name and "Save Changes" would blank `full_name`. "Change photo" (`profile.tsx:39-41`) has no handler.
10. **Placeholder settings shipped as real**: Appearance (`appearance.tsx:17`) and Language (`language.tsx:17`) are local `useState` only; Security's biometric toggle (`security.tsx:39-80`) writes a SecureStore flag that nothing ever checks (no launch gate, no step-up). Signup Terms/Privacy links point to `https://familycheckin.app/...` (`signup.tsx:131-137`), an unowned placeholder domain.

Secondary: siren asset is a 0.35 s, 8 kHz mono blip (5.6 KB) not a siren; duplicate deep-link processing (root layout + callback screen) makes email confirmation flash "Verification Failed"; no 401/429 handling, no timeout, no retry in `backendRequest`; Supabase session persisted in plain AsyncStorage, not SecureStore (documented decision, but the refresh token is unencrypted); expo-doctor fails 3/18 checks.

## 2. Screen / flow inventory

| Flow (route) | Status | Evidence | What is missing |
|---|---|---|---|
| Splash `/` -> auth or main | OK | `app/index.tsx:11-25` | - |
| `(auth)/welcome` | OK | `welcome.tsx:14-20` | - |
| `(auth)/login` email | OK | `login.tsx:42-54` calls `signIn` then `syncAuthenticatedUser`; Alert on sync failure | `router.replace('/onboarding')` at `:49` is immediately overridden by `ProtectedRoute.tsx:27-30` (auth group + authenticated -> `/(main)`); harmless but dead. Apple button shown on Android. |
| `(auth)/login` Google / Apple | BROKEN (high confidence) | `auth.ts:113-125` custom `state`; `supabase.ts:106-111` requires echo | Remove the custom state check (PKCE already protects the flow) or verify on a device. `login.tsx:56-68` success handlers are empty comments. |
| `(auth)/signup` email | PARTIAL | `signup.tsx:99-111` | If Supabase email confirmation is on, `signUp` returns no session, sync throws (swallowed `:106-108`) and the user is dropped on the unauthenticated "Add receiver" form (`/onboarding`), whose submit will fail with "You need to sign in again" (`backendApi.ts:517`). No "check your email" state. |
| `(auth)/signup` social | BROKEN | same OAuth state issue; `signup.tsx:113-129` | - |
| `(auth)/forgot-password` | OK | `forgot-password.tsx:35-46` | - |
| `auth/reset-password` | PARTIAL | `reset-password.tsx:32-63` relies on `Linking.getInitialURL()` | Warm-start links: `_layout.tsx:27-31` only navigates, does not exchange the code; `getInitialURL` is stale on iOS -> "No valid session found". |
| `auth/callback` | PARTIAL | `callback.tsx:15-53` re-runs `handleAuthDeepLink` on the same URL as `_layout.tsx:33-43` | Second `exchangeCodeForSession` fails -> "Verification Failed" then bounce to login while already signed in. |
| `(auth)/onboarding` = `(main)/receiver-setup` (add receiver) | OK | `onboarding.tsx:62-120` -> `POST /receivers`; paywall alert on `PAID_ACCESS_REQUIRED` `:102-115` | No success toast (consent request sent); relies on navigation only. |
| `(main)/index` dashboard | PARTIAL | `index.tsx:12,65-89`; `useLovedOnes.ts:70-76` | Error state never rendered (shows empty state on failure). "Review receivers" quick action pushes `/(main)` (`:54`) = no-op. |
| `(main)/receivers/[id]` | OK | load `:70-93`, edit `:144-175`, pause/resume `:177-189`, check-in actions `:200-240`, backup CRUD `:274-366`, remove with OTP step-up `:368-441` | Backup edit form cannot show/edit existing location instructions (backend only returns `hasLocationInstructions`). |
| `(main)/check-ins`, `escalations`, `loved-ones`, `pairing` | Legacy redirects | 5-line `Redirect` stubs | Delete or keep; harmless. |
| `(main)/admin-operations`, `/[checkInId]`, `admin-abuse-reports` | OK | `admin-operations.tsx:16-30`, `[checkInId].tsx:22-40`, `admin-abuse-reports.tsx:24-64` | Sidebar (`Sidebar.tsx:10-15`) shows admin items to every user; non-admins get a 403 error screen. |
| `settings/profile` | BROKEN | `profile.tsx:14-22`; `useProfile.ts:42-55,69-77` | Form seeded before load; phone read from wrong field; phone save path needs SMS provider; "Change photo" dead. |
| `settings/billing` | OK (gated) | `billing.tsx:47-121` -> `/billing/status`, RevenueCat offerings/purchase/restore | Buttons disabled until `EXPO_PUBLIC_REVENUECAT_*` keys exist; after purchase relies on webhook having landed (`:82`), no polling. "Manage" is text only. |
| `settings/security` | PLACEHOLDER | `security.tsx:39-80`; `biometric.ts:112-124` | Flag never enforced anywhere (grep `isBiometricEnabled` = only the settings screen). BRD "Test my siren" control absent. |
| `settings/data-privacy` | OK | `data-privacy.tsx:31-137` OTP step-up -> `GET /account/export` (share sheet) / `DELETE /account` | Export type in `userData.ts:7-18` names `checkins`/`escalationEvents`; backend returns `checkIns`/`escalations` (type-only, data passed through). |
| `settings/appearance`, `settings/language` | PLACEHOLDER | `appearance.tsx:17`, `language.tsx:17` | Nothing persisted, no theme/i18n system (`theme/colors.ts` static). Hide until real. |

Direct Supabase table access from the app: none (`grep supabase.from|rpc|storage` = 0 hits). `database.types.ts` only types the client. RLS policies in `apps/backend/prisma/*.sql` are therefore not exercised by mobile; all data goes through the NestJS backend with the Supabase JWT. Good.

## 3. Mobile <-> backend contract

`backendRequest` (`backendApi.ts:507-536`): base URL from `EXPO_PUBLIC_BACKEND_URL` with Android `localhost -> 10.0.2.2` rewrite (`:543-545`); headers `Accept`, `Content-Type: application/json`, `Authorization: Bearer <supabase access_token>` from `getSession()` on every call. Backend authenticates by calling Supabase `/auth/v1/user` per request (`supabase-auth.service.ts:35-49`) and upserts the sender (`users.service.ts:23`). Global throttler 300 req / 60 s per IP (`app-config.service.ts` defaults; `app.module.ts:48`). Helmet + CORS allow no-Origin native clients (`http-hardening.ts:29-40`).

| Mobile fn (`backendApi.ts`) | Method / path | Backend handler | Body / headers | Response read by UI | Verdict |
|---|---|---|---|---|---|
| `syncAuthenticatedUser` :262 | POST `/auth/sync-user` | `auth.controller.ts:17` | none | `{user:{id,country,preferredLanguage,timezone}}` | match |
| `listReceivers` :270 | GET `/receivers` | `receivers.controller.ts:99` | - | `{receivers: ReceiverSummary[]}`; all fields incl. `latestCheckIn`, `pausedReason`, `scheduleTimeWindow` present in `receivers.service.ts:792-826` | match |
| `getReceiver` :278 | GET `/receivers/:id` | `:109` | - | `{receiver:{...,backupContacts,escalation}}` | match |
| `pauseReceiver` :286 | PATCH `/receivers/:id/pause` | `:138` | optional `{pausedUntil}` | `{receiver}` | match |
| `resumeReceiver` :310 | PATCH `/receivers/:id/resume` | `:164` | - | `{receiver}` | match |
| `updateReceiver` :318 | PATCH `/receivers/:id` | `:188` | full `ReceiverUpdateInput`; backend 400s if `relationshipType/techProfile/primaryChannel` missing | `{receiver}` | match |
| `deleteReceiver` :327 | DELETE `/receivers/:id` | `:226` | header `x-nearby-step-up-token` (consumed for `REMOVE_RECEIVER`) | ignored | match |
| `resolve/alertBackup/tryLater` :429-457 | PATCH `/receivers/:id/check-ins/:cid/{resolve,alert-backup,try-later}` | `:252,:278,:304` | - | `{receiver}` | match |
| backup contacts list/create/update/delete :459-496 | `/receivers/:id/backup-contacts[/:bid]` | `backup-contacts.controller.ts:45-148` | create requires `phone`; update phone optional | `{backupContacts}` / `{backupContact}` | match |
| `createReceiver` :498 | POST `/receivers` | `:330` | `ReceiverSetupInput` | `{receiver: CreatedReceiver}`; 403 `{code:'PAID_ACCESS_REQUIRED'}` mapped by `backendErrors.ts:15` | match |
| `registerDeviceToken` :295 | POST `/device-tokens` | `notifications.controller.ts:24` | `{token,platform,deviceId}` (`deviceId=Constants.sessionId`, changes every launch) | `{deviceToken}` | match; invalid token throws plain `Error` -> 500 not 400 (`notifications.service.ts:57`) |
| `getAdminMe` :336 | GET `/auth/admin/me` | `auth.controller.ts:33` | - | `{admin:{id,role}}`; 403 for non-admin | match |
| `getBillingStatus` :344 | GET `/billing/status` | `billing.controller.ts:37` | - | `BillingStatusResponse` (`billing.service.ts:7-18`) | match |
| step-up request/verify :350-362 | POST `/account/step-up/{request,verify}` | `account.controller.ts:25,38` | `{action}` / `{challengeId,code}`; OTP sent by SMS via channel router (`step-up.service.ts:40`) | `{ok,challengeId,expiresAt}` / `{ok,stepUpToken}` | match |
| `exportAccountData` :364 | GET `/account/export` | `:49` | header step-up token | opaque JSON | match (mobile type keys wrong, see above) |
| `deleteAccount` :373 | DELETE `/account` | `:62` | header step-up token | `{ok,deletedAt}` | match |
| operations summary/detail :382-397 | GET `/operations/check-ins/summary`, `/:id` | `operations.controller.ts:52,60` | - | `{ok,...}` / `{ok,checkIn}` | match |
| abuse list / review :399-427 | GET `/admin/abuse-reports`, PATCH `.../review-safe`, `.../review-action-taken` | `admin-abuse.controller.ts:17,41,57` | - | `{ok,abuseReports}` / `{ok,abuseReport}` | match |

Cross-cutting gaps (all in `backendApi.ts:507-568`):
- **401**: surfaced as an error string only; no sign-out, no refresh retry. Backend returns 401 both for expired JWT and for "user is missing a phone number" (`supabase-auth.service.ts:44,60`), which the UI cannot distinguish.
- **403 `PAID_ACCESS_REQUIRED`** handled only in `onboarding.tsx:102`; receiver detail edit/pause do not gate (backend doesn't either).
- **429**: none; the raw Nest "ThrottlerException: Too Many Requests" message is shown.
- **Timeout / retry / backoff**: none (`fetch` without `AbortController`).
- **Token refresh**: relies on supabase-js `getSession()` auto-refresh; no `AppState` -> `startAutoRefresh/stopAutoRefresh` wiring, so refresh timers stall while backgrounded.
- Enum values (`RelationshipType`, `TechProfile`, `Channel`, `CheckInStatus`, `ConsentStatus`, `SensitiveAction`, roles) match Prisma; `database.types.spec.ts` compile-checks them.

## 4. Supabase auth boundary

- Client: PKCE, `detectSessionInUrl:false`, `autoRefreshToken`, session storage = **AsyncStorage on native** (`auth-storage.ts:35-41`), SecureStore only for the OAuth state nonce (`:31`). Handoff "Protected Auth Boundary" documents this; the refresh token is therefore unencrypted at rest.
- Sign-up: `emailRedirectTo: familycheckin://auth/callback`; PKCE code exchange in `supabase.ts:117-123` works only on the same device that started signup (verifier in AsyncStorage) - expected.
- OAuth: see blocker 3. Also `redirectTo = makeRedirectUri({scheme,path})` is right for dev/store builds; under Expo Go it becomes `exp://...` which `isAllowedAuthRedirect` (`supabase.ts:47-53`) rejects, so social login cannot even be smoke-tested in Expo Go.
- Deep links: root layout handles cold + warm (`_layout.tsx:15-56`); callback and reset screens re-handle `getInitialURL` -> double exchange (see table).
- Sign-out: `supabase.auth.signOut()` only. Does not clear device token, biometric flag, or RevenueCat identity.
- Token attached consistently: yes, every backend call goes through `backendRequest`. `useProfile` calls `supabase.auth.getUser()` (network) from Header, ProfileMenu and Dashboard simultaneously (3 calls per main-layout mount).
- Biometric: SecureStore flag only; never gates launch or sensitive actions. Step-up for delete/export/remove is SMS OTP through the backend (works, and is what the BRD wants).

## 5. Push notifications

- Registration (`pushNotifications.ts:32-72`): runs once per session (`AuthContext.tsx:58-77`), skips web and Android-in-Expo-Go, creates Android channel `emergency-alerts` (MAX importance, siren sound, vibration, `bypassDnd:false`) then asks permission and posts the Expo token. Matches backend payload (`notifications.service.ts:100-115`: `sound: escalation-siren.wav`, `channelId: emergency-alerts`, `interruptionLevel: timeSensitive`).
- Missing: `projectId` (blocker 2); Android FCM config (blocker 5); foreground handler + tap/deep-link handler (blocker 6); unregister on sign-out (blocker 7); iOS `com.apple.developer.usernotifications.time-sensitive` entitlement in `app.json` (`ios.entitlements` absent) so Time Sensitive is downgraded; no permission-denied UX (returns silently `:61-63`); no re-registration if permission is granted later.
- Asset: `assets/sounds/escalation-siren.wav` is 0.35 s, 8 kHz mono, 5.6 KB - a beep, not a siren. Plugin config in `app.json:63-68` is correct.
- Simulators: iOS simulator `getExpoPushTokenAsync` throws (caught, warn only); Android emulator works only with Play services + FCM config; Expo Go iOS works once projectId is set.

## 6. Billing (RevenueCat)

- SDK loaded lazily (`revenueCat.ts:119-126`), configured with `appUserID = backend user id` (`:65`) which is exactly what the webhook resolves (`billing.service.ts:66`). Entitlement id `nearby_access` on both sides (`revenueCat.ts:12`, `billing.service.ts:39`). Purchase/restore return local entitlement; UI then re-reads `/billing/status` (`billing.tsx:82,102`) which is webhook-driven, so a just-purchased user can see "No active subscription" for seconds to minutes with no retry. Backend gating: only `POST /receivers` (`receivers.controller.ts:340-347`).
- Re-`configure()` on user switch (`revenueCat.ts:64-67`) instead of `logIn/logOut`; `userCancelled` not special-cased. No `getCustomerInfo` on load (plans come from `getOfferings`). Keys absent in `.env` -> screen correctly disables buttons (`billing.tsx:157,170`).

## 7. Config and build readiness

- `app.json`: bundle id / package `com.familycheckin.app`, scheme `familycheckin`, icons 1024x1024 present, splash present, `newArchEnabled`, typed routes. Missing: `extra.eas.projectId`, `owner`, `android.googleServicesFile`, `ios.entitlements` (time-sensitive), `ios.buildNumber`/`android.versionCode` (EAS `appVersionSource: local` -> defaults to 1), `ITSAppUsesNonExemptEncryption`. Unused `NSCameraUsageDescription`/`NSPhotoLibraryUsageDescription` (no photo feature). `RECEIVE_BOOT_COMPLETED` permission unneeded. `autoVerify:true` on the custom scheme and on `https://*.supabase.co` without assetlinks (harmless, verification fails).
- `eas.json`: `${VAR}` env interpolation (blocker 1); no `EXPO_PUBLIC_BACKEND_URL` / RevenueCat env in any profile; `submit.production.android.serviceAccountKeyPath: ./google-services.json` is the wrong file type (Firebase config, not a Play service-account key) and is gitignored; no iOS submit block.
- `.env.example`: covers Supabase, backend URL, RevenueCat keys/entitlement. Does not mention EAS project id or FCM.
- `metro.config.js`: `disableHierarchicalLookup: true` + workspace watchFolders; expo-doctor flags it and finds hoisted duplicates `react@19.2.8` / `react-native@0.87.1` at the monorepo root vs `19.1.0` / `0.81.5` in `apps/mobile` - native build risk.
- Static run (`scratchpad/audit/expo-doctor.txt`, `expo-config.txt`): `expo config --type public` resolves cleanly (SDK 54.0.0, plugins ok). `expo-doctor`: **15/18 passed**; failures = Metro overrides, duplicate native deps (react, react-native), patch mismatches `expo-local-authentication`/`expo-localization` 17.0.8 vs ~17.0.9.

## 8. Tests

`npm test --project mobile`: 10 files / 26 tests, node environment, no React Native rendering. Coverage: `auth-storage.test.ts` (storage routing, 3), `auth.spec.ts` (signup metadata, Google metadata persistence with `handleAuthDeepLink` mocked, 2), `backendApi.spec.ts` (error code propagation, step-up header, 2), `backendErrors.spec.ts` (3), `database.types.spec.ts` (enum alignment, 1), `pushNotifications.spec.ts` (Android channel created before registration, 1), `revenueCat.spec.ts` (plan mapping, 2), `utils/*.spec.ts` (label/sort helpers, 12). Not covered: `handleAuthDeepLink` state/code paths, `backendRequest` 401/429/timeout, `AuthContext`, `ProtectedRoute`, `useProfile`, any screen.

## 9. Suggested fix order

1. Fix `eas.json` env (use EAS environment variables / `.env.production`, no `${}`), set `extra.eas.projectId` + `owner`, add FCM `googleServicesFile`, correct submit config.
2. Drop the custom OAuth `state` check (or prove it on a device), de-duplicate deep-link handling, add a "confirm your email" state after signup.
3. Profile: read/write `user_metadata.phone`, seed form after load, remove "Change photo".
4. Push: `setNotificationHandler`, response listener -> `data.deepLink`, unregister on sign-out (needs backend DELETE), real siren asset, time-sensitive entitlement.
5. `backendRequest`: timeout, 401 -> sign-out, 429 -> friendly retry, minimal backoff for GETs.
6. Dashboard error state; hide Appearance/Language/biometric toggle until implemented; real Terms/Privacy URLs; "Test my siren" control.
