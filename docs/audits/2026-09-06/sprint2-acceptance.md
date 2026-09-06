# Sprint 2 acceptance — Android emulator and API against the fake-provider backend (2026-09-06, evening)

Run against `master` at `4a58dfc` (PRs #25–#31 merged) on the Pixel_7 AVD via Expo Go, compiled backend (`node dist/main.js`), throwaway
`postgres:16-alpine` on 56432 with all 14 migrations (`db:apply-all` 7 manual files, `db:check-invariants` 12 checks / 654 assertions /
0 violations, template seed 18 rows × 8 languages). Backend env from the shell (fake mode, all-zero KMS key, cron secret fixture,
`PUBLIC_API_BASE_URL=http://10.0.2.2:3000`, a dummy `TWILIO_AUTH_TOKEN` so the signed status route could be exercised). Metro
`CI=1 npx expo start --android`, restarted once with `--clear` (see F5). Founder's test account; subscription and admin row seeded by SQL as
in the sprint-1 run. Screenshots `emu-s2-NN-*.png` (28) in `private/emulator-2026-09-06/` (gitignored). Method as before: `uiautomator dump` +
`adb input`, fake reply route, ticks, `GET /receiver-replies/fake/outbound` for bodies and OTPs, and a signed-webhook helper for Twilio callbacks.

Every check below was confirmed in the database the backend writes to (rows, statuses, audit entries), not only on screen.

## Regression of the sprint-1 runbook

| # | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| R1 | Login | PASS | Dashboard greeting; `POST /auth/sync-user` 201 now returns `preferredLanguage: "en"` (no padding, CB-075) and stores the display name. |
| R2 | Add receiver with note | PASS | Margaret added through the app with the new 15-minute pickers (13:00–16:00) and the London zone showing `UTC+1`; consent body `Hi Margaret, Shahbaz Malik asked Nearby…` with the note (sender name, CB-010). |
| R3 | YES → consent granted, app updates | PASS | Card moved to "Awaiting reply" on return to the dashboard without pull-to-refresh (CB-071). |
| R4 | Tick → check-in body | PASS | `Hi Margaret, Shahbaz Malik is checking in on you today. Their note: …`. |
| R5 | YES → OK | PASS (covered by sprint 1; re-checked on Fatima in Arabic) | — |
| R6 | Cascade exhaustion → NEEDS_ATTENTION, one siren | PASS | Detail "Needs attention", one `sender_voice_fallback.sent cascade_exhausted`. |
| R7 | HELP with backup → one alert; DONE → resolved | PASS | Exactly one `escalation_event` (WHATSAPP, CB-011); body `…Margaret asked for help during a check-in from Shahbaz Malik…` to Ahmed with location instructions; sender siren `help_response`; DONE → RESOLVED; `resolutionNote` = `Backup contact reply: DONE` shown in the app (CB-018). |
| R8 | REPORT → paused; Mark safe → unpaused | PASS | Tick while paused `created:0`; Abuse Reports "Mark safe" → `REVIEWED_SAFE`, pause cleared, next tick `created:1`. |
| R9 | STOP mid-cascade | PASS / F1 | Attempt 2 SKIPPED `receiver_opted_out`, cooldown row +7 days, `check_in.cancelled`; receiver confirmation `receiver_checkins_ended` sent (CB-012) and sender quiet push audited `sender_push.not_delivered receiver_opted_out` — but see F1 for the confirmation's wording. |
| R10 | Free text / unknown / short code | PASS (sprint 1; unchanged code) | — |
| R11 | Timezone `Dubai` → 400 | PASS | `400 INVALID_TIMEZONE` via API. |
| R12 | Step-ups: remove receiver, export | PASS / F2 | Export: OTP consumed, share sheet with the JSON. Remove: OTP verified and consumed, receiver soft-deleted, open check-ins and the try-later retry row cancelled, lifecycle SMS `Hi Margaret, Shahbaz Malik has ended your Nearby check-ins…` — but two of the three attempts hit F2 on the device before the server-side delete happened. |

## New behaviour from sprint 2

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| N1 | Consent resend (CB-009) | PASS (product note F3) | Detail shows "Waiting for Margaret to reply YES." and "Resend invitation"; tapping it shows "You can resend on Sep 13, 2026, 5:22 PM." (429 `CONSENT_RESEND_LIMIT`). API: both resends 429 because the first invitation counts toward the 7-day cap. |
| N2 | Opt-out cooldown copy in the app (CB-009) | PASS (after F5) | Re-adding Fatima's number: "This person opted out recently; you can invite them again after Sep 13, 2026, 5:22 PM." API body `409 {code: OPT_OUT_COOLDOWN, cooldownUntil}`. |
| N3 | Second sender, same phone (CB-014) | NOT RUN | Needs a second Supabase user; covered by specs. |
| N4a | Try-later on a SENT check-in (CB-017) | PASS | "A check-in is still in progress for this receiver. Wait for it to finish before trying again." (409 `CHECK_IN_IN_PROGRESS`). |
| N4b | Try-later on NEEDS_ATTENTION (CB-017/013) | PASS | New PENDING row with `retryOf` set, `scheduledLocalDate` 2026-09-06, due in 1 h 59 min; audit `check_in.try_later_requested {retryAt}`. |
| N5 | Local-day dedupe (CB-013) | PASS | Second tick `created:0`; moving an old row onto an already-used local day is refused by `check_ins_receiverId_scheduledLocalDate_key`. |
| N6 | Alert backup contacts (CB-074) | PASS (zero-backup notice not observed) | With Ahmed: "Alerted 1 backup contact", status "Backup alerted", one WhatsApp `backup_contact_sender_requested_alert`, no sender siren (`sender_push.skipped sender_initiated`). With no backups: backend correct (`escalation.no_backup_contacts`, skipped siren, no send) but the in-app notice was not seen in the dump 7 s later. |
| N7 | Resolution note (CB-018) | PASS | Inline note form with `36/200 - stored encrypted; only you can read it.`; Note row on the detail; DB `resolutionNote` ciphertext (88 chars), status RESOLVED. |
| N8 | Invalid schedule (CB-069) | PASS | Timezone set to `Dubai` by SQL: 3 ticks → exactly one `check_in.schedule_invalid`, one `sender_push.not_delivered schedule_invalid` with the receiver deep link, `scheduleInvalidAt` set; dashboard chip "Schedule needs attention"; detail warning + "Edit schedule"; fixing the zone clears the stamp and the chip on the next tick/refetch. |
| N9 | Delivery status callback (CB-016) | PASS | Signed `MessageStatus=undelivered` → attempt 1 `FAILED twilio_status_undelivered`, audit `check_in.attempt_failed {providerErrorCode: 30003}`, attempt 2 pulled forward and sent on the next tick; replay `processed: 0`; unsigned 401; `delivered` recorded only; 2 `messaging_status` events / 2 key rows, payload PII-free. |
| N10 | `checkin_retry` on attempt 2 (CB-010) | PASS | Attempt 2 SMS rendered `checkin_retry` in Arabic: `مرحباً Fatima، لم يصلنا ردك بعد. هذه رسالة من Shahbaz Malik…`. |
| N11 | Arabic receiver end to end (CB-075/CB-010 seed) | PASS | `POST /receivers` returns `language: "ar"`; consent and check-in bodies in Arabic script with the sender's name and the note, no `{{` left. |
| N12 | Labels and pickers (CB-072/073/077) | PASS | Sign-up "Your phone number"; backup form "Backup contact phone"; opted-out Fatima reads "Opted out" on the dashboard and "Skipped" in Admin Operations (no "No backup available"); pickers in 15-minute steps; London `UTC+1`. |
| — | Backup-contact removal from the app | PASS (incidental) | Ahmed soft-deleted through the row's Remove button. |

## Findings

- **F1 (backend copy, new CB-079)** — the STOP confirmation `receiver_checkins_ended` sent from `receiver-reply.service.ts` still uses the
  neutral fallback: the Arabic body reads `…بطلب من your family member…` (English phrase inside Arabic text, no sender name). The pause and
  delete lifecycle paths do use the sender's name. Fix: resolve `senderDisplayName` through `UsersService.senderDisplayNameFor` there too, and
  never inject an English fallback into a non-English body (localise the fallback per language in the seed).
- **F2 (client/server transport, new CB-080)** — three times in this run a response reached the device with an empty body although the
  server had executed the request and answered with JSON: `GET /receivers` (red LogBox "JSON Parse error: Unexpected end of input" from
  `useLovedOnes.ts`), `POST /account/step-up/verify` (challenge verified server-side, client aborted before `DELETE`), and
  `DELETE /receivers/:id` (receiver deleted server-side, banner shown instead of navigating). Same class as the `Backend request failed with
  status 409` fallback seen on a 409 before the Metro restart. Not reproducible with curl. Suspects: Node's 5-second `keepAliveTimeout`
  versus OkHttp connection reuse through the emulator NAT, Express ETag/304 on GETs, or the response being read before the body arrives.
  Fix on both sides: server `Connection: close` or a longer keep-alive timeout plus `Cache-Control: no-store` on API responses; client
  (`backendRequest`) retries idempotent requests once on an empty 2xx body and treats the empty body as an error with a clear message
  (extends CB-037).
- **F3 (product question, new CB-081)** — "Resend invitation" counts the first invitation toward the weekly cap, so a sender who added a
  receiver today cannot resend for seven days unless the first send failed. The BRD says "one per week max"; decide whether the first send
  should start the clock or the button should allow one resend after 24–48 h.
- **F4 (mobile, new CB-082)** — Metro logged `Unable to register push notifications: [SyntaxError: 3791:13:';' expected]` after the
  cache-cleared rebuild: the lazily imported `expo-notifications` chunk failed to parse in Expo Go. Registration is skipped in Expo Go
  anyway, so no user impact today, but the chunk must be checked in a development build (relates to CB-030/031).
- **F5 (tooling, runbook note)** — Metro in `CI=1` mode served a stale module for the add-receiver screen after the code changed (the
  cooldown alert showed the raw status fallback until Metro was restarted with `--clear`). Runbook now says to start Metro with `--clear`
  after pulling new code, and that the served bundle can only be checked with the device's own request URL (a bare
  `entry.bundle` request has no routes in it).
- **Observation** — with zero backup contacts the in-app alert-backup notice was not observed; with one backup it was. Re-check when
  CB-074's notice is touched next.
- **Observation** — the check-in voice script for the WhatsApp→SMS receiver never fired here (SMS fallback took over), so the
  `checkin_daily_voice {}` gap from the sprint-1 run (CB-022 note) is unchanged.

## Cleanup

Backend, Metro and the emulator stopped after the run; `nearby-dev-pg` removed. Hosted Supabase: the founder then applied the five
sprint-2 migrations (`202609060101`, `0102`, `0103`, `0201`, `0202`) through the Supabase management API (`202609050001` was already
there). Verified afterwards: the new columns exist, language columns are `varchar(8)`, `channel_templates` holds 144 rows (18 per
language), `provider_webhook_event_keys` exists with RLS on and no client policies, and the seven existing receivers and check-ins were
preserved. Recorded in `docs/handoffs/data-security-and-privacy.md`.
