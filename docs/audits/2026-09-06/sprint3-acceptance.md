# Sprint 3 wave 1 acceptance — Android emulator and API against the fake-provider backend (2026-09-06, late evening)

Master `d9e2350` (PRs #34, #35, #36 merged). Throwaway Postgres `nearby-dev-pg` (all migrations, invariants 12 checks / 666 assertions), compiled backend (`node dist/main.js`) in fake mode with `TWILIO_AUTH_TOKEN=local-test-token`, `PUBLIC_API_BASE_URL=http://10.0.2.2:3000`, `REVENUECAT_WEBHOOK_AUTH_TOKEN=local-revenuecat-token`; Pixel_7 AVD (Android 16), Expo Go 54 freshly installed by Expo CLI (the AVD had lost it), Metro `CI=1 npx expo start --android --port 8081 --clear`. Founder's test account; subscription seeded by SQL (`subscriptions` row `ACTIVE`, `TIER_1`) after the paid-access gate showed "Subscription required" once (same as the sprint-1 run). Driven with `adb shell input` and `uiautomator dump` (`MSYS_NO_PATHCONV=1` under Git Bash, otherwise `/sdcard` is rewritten). Screenshots and UI dumps stayed in the session scratchpad.

## Sprint 3 checks (`docs/EMULATOR_RUNBOOK.md` §5, "Sprint 3 checks")

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| S3-1 | CB-048 `GET /health` | PASS | `200 {"status":"ok"}`; with the container paused `503 {"status":"degraded"}`; `200` again after unpause. |
| S3-2 | CB-019, CB-021 removed inbound routes | PASS | `POST /provider-webhooks/sms` and `/whatsapp` both `404`. |
| S3-3 | CB-022 signed voice Gather action | PASS | Unsigned `401`, wrong signature `401`. `Digits=1` (`?lang=en`) → `200`, `<Response><Say language="en-GB" voice="Polly.Amy">…</Say><Hangup/></Response>`, the open check-in became `RESPONDED_OK`. `Digits=7` (`hi`) → `200` with a Hindi `<Say>`, no state change. `Digits=9` (`ar`) → `200` with an Arabic `<Say>`, consent `REVOKED`, `receiver_checkins_ended_voice` queued. Signature computed over `${PUBLIC_API_BASE_URL}/provider-webhooks/twilio/voice?lang=<code>` + sorted params. |
| S3-4 | CB-026 RevenueCat webhook | PASS | Wrong token `401`; right token with `{}` → `400 {"message":"RevenueCat webhook payload is invalid"}`; no header `401`. |
| S3-5 | CB-045 overlapping ticks | PASS | Two concurrent `POST /operations/check-ins/run`: one full result, the other `{"ok":true,"locked":true}`. |
| S3-6 | CB-080 empty bodies on the device | PASS | Ten consecutive receiver-detail loads (back, reopen) rendered every time; backup contact removed (confirm dialog, row gone, API `[]`); receiver removed through the step-up code (OTP read from the fake outbound list, dashboard without the receiver). No "JSON Parse error" in LogBox or Metro. Server replies carry `Cache-Control: no-store` and `Keep-Alive: timeout=305`. |
| S3-7 | CB-081 resend window | PASS | Right after adding Amina: API `consentResendAllowedAt` = send time + 24 h; detail shows "Resend invitation" disabled with "Resend available Sep 7, 2026, 10:54 PM" (local). After `UPDATE receivers SET "consentRequestedAt" = now() - interval '25 hours'`: button enabled, tap → "Invitation sent again…", second `consent_request` in the outbound list, button disabled with "Resend available Sep 13, 2026, 10:55 PM". API resend inside the window → `429 {"code":"CONSENT_RESEND_LIMIT","nextAllowedAt":"2026-09-13T18:55:57.079Z"}`. After STOP, `consentResendAllowedAt` is `null`. |
| S3-8 | CB-079 Arabic STOP confirmation | PASS | Receiver created with language Arabic from the app form. Consent request (with the personal note) and the STOP confirmation are Arabic, both name the sender ("بطلب من Shahbaz Malik"), no Latin "your family member". |
| S3-9 | CB-023 device-token validation | PASS | `{"platform":"windows"}` → `400 "platform must be one of ios, android, web"`; `{"token":"not-an-expo-token"}` → `400 "A valid Expo push token is required"`. Push registration in Expo Go still skipped (CB-031); receipts not exercisable on the emulator. |
| S3-10 | CB-024 local token verification | PASS | Sign-in and every authenticated screen work with no Supabase call per request (the project publishes an ES256 JWKS key). `GET /receivers` `200`; a token with one payload character changed `401`; one signature character changed `401`; `alg: none` `401`; garbage `401`. (Changing only the last base64 character of the signature can leave the decoded bytes identical and still verify; that is base64 padding, not a defect.) |
| S3-11 | CB-020, CB-021, CB-025 configured-mode boot | PASS | `CHANNEL_PROVIDER_MODE=configured` with no `TWILIO_*` value in the shell: boots, `/health` `200`, `POST /receiver-replies/fake` and `GET …/fake/outbound` `404`. (`SUPABASE_SERVICE_ROLE_KEY` still had the `.env` placeholder; optionality is covered by `app-config.service.spec.ts`.) |

## Regression of the loop the new attempt claim touches

Fatima (language Urdu, window covering "now") with backup contact Omar: `YES` → tick created and sent `checkin_daily` → `HELP` → `check_in.escalated`, `backup_contact_help_alert` in Urdu naming the sender, `sender_escalation_siren_voice` call after `sender_push.not_delivered` (no device token) → `DONE` from Omar → `check_in.resolved_by_backup` → `REPORT` → `abuse_reported`, next tick creates nothing. Harold (English): consent, tick, check-in sent naming the sender with the note, resolved by voice digit 1. Amina (Arabic): a tick outside her 09:00–11:00 window created nothing (expected; CB-013 dedupes per local day).

## Findings

No new backlog items. Observations:

- Expo Go was missing from the AVD and Expo CLI installed it; the first launch hung with "Expo Go isn't responding" while Metro had already bundled. Force-stop and reopening `exp://<host>:8081` fixed it (runbook already describes the reopen).
- The dashboard greets "Good evening, there!" and hides the receiver list for about two seconds after the step-up removal returns, before the profile and list load. Cosmetic loading state; not tracked.
- The Metro warning `Unable to register push notifications: SyntaxError …` from the lazily imported `expo-notifications` chunk is still present in Expo Go (CB-082, Phase 3).

## Cleanup

Backend, Metro and the emulator stopped; `nearby-dev-pg` removed. The two migrations from #34 are still pending on the hosted Supabase project (founder runs the management-API script).
