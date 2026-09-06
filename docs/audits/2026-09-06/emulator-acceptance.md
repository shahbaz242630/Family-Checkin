# Emulator acceptance — Android emulator against the fake-provider backend (2026-09-06)

Run of `docs/EMULATOR_RUNBOOK.md` on the Pixel_7 AVD (Expo Go, SDK 54) against the compiled backend (`node dist/main.js`) from
`master` at `0138c2b` (CB-067 merged), later rebuilt at the same commit plus the CB-070 fix. Database: throwaway
`postgres:16-alpine` on 56432, `db:apply-all` 7 files applied, `db:check-invariants` 12 checks / 630 assertions / 0 violations.
Backend env came from the shell (`DATABASE_URL`, `CHANNEL_PROVIDER_MODE=fake`, the all-zero KMS key, the operations cron secret
set to the runbook's fixture value, `PORT=3000`, `PUBLIC_API_BASE_URL=http://10.0.2.2:3000`); `apps/backend/.env` was not edited. Real Supabase auth was used with
the founder's test account. Fifty-three screenshots are kept locally in `private/emulator-2026-09-06/` (gitignored: they show the
founder's name and account), named `emu-NN-<step>.png` and referenced below by number.

Driving method: adb + `uiautomator dump` for element bounds, `input tap` / `input text` for interaction, the fake reply route for
receiver replies, `POST /operations/check-ins/run` for ticks, and `GET /receiver-replies/fake/outbound` (CB-067) to read what the
fake providers sent, including step-up OTP codes.

## Environment problems fixed before the run

| Problem | Fix |
| --- | --- |
| A Windows **user-level** environment variable `EXPO_PUBLIC_SUPABASE_URL` pointed at the Sandoq Kin Supabase project. Expo never overrides an existing variable from `.env`, so the first bundle used the wrong project URL with our anon key. | Variable deleted from the User scope (Sandoq Kin's own `.env` already defines it). Recorded in the main handoff gotchas and the runbook prerequisites. |
| The emulator resumed with the Sandoq Kin app in the foreground (shared AVD snapshot). | Home key, then Expo Go opened our project. Runbook note added. |
| `apps/backend/.env` has no `DATABASE_URL` and no `KMS_MASTER_KEY_BASE64`; its `SUPABASE_SERVICE_ROLE_KEY` is a placeholder (Supabase answers 401 to it). Anon keys in both env files are valid and identical. | Backend started with the values in the shell environment. The service-role key is unused by the backend (CB-025) so nothing in the run needed it; Supabase admin API calls are therefore not possible from this machine. |
| Supabase email validation rejects `example.com` and `.dev` test addresses, and a real-looking address hit the default SMTP rate limit (email confirmation is on). | Used the founder's existing test account instead of creating one. |

## Scenario results

| # | Runbook scenario | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Email login; profile shows name/phone | **PASS** (login) / **KNOWN GAP** (profile, CB-033) | Login form (14), dashboard "Good afternoon, Shahbaz!" with empty state (15). API `POST /auth/sync-user` 201. Profile screen shows the empty "Your name" placeholder and `+1 234 567 8900` although `user_metadata` holds the name and `+971…567` (45); the profile menu says "Add phone number" (44). Sign-up form itself renders and validates (5–13); a new account could not be created because of Supabase email validation and the SMTP rate limit, not an app fault. |
| — | Paid-access gate (not in the runbook) | **PASS** | Submitting the receiver form with no subscription showed "Subscription required" with NOT NOW / VIEW BILLING (21); no receiver row, nothing sent. After seeding an `ACTIVE` subscription by SQL, `GET /billing/status` returned `entitled: true` and the same form submitted. |
| 2 | Add receiver with a personal note → consent request in English with the note | **PASS** | Receiver "Margaret", SMS→VOICE, Europe/London, 09:00–11:00, note "Remember your tablets, love from Sam" (16–20). Dashboard card "Margaret · Pending consent · Via SMS" (22). Terminal line `[fake-provider] SMS message to ***4501 (consent_request, en) fake-SMS-message-1: "Hi Margaret, your family member asked Nearby to check in on you with a short daily message. Their note: \"Remember your tablets, love from Sam\" Reply YES to agree. Reply STOP to stop, REPORT to report."`; same body on the outbound route. |
| 3 | Fake `YES` → consent granted in the app | **PASS** (backend) / **DEFECT D1** (dashboard) | `consent_granted`, `consentGrantedAt` set. Receiver detail shows "Awaiting reply" (23). The dashboard card kept saying "Pending consent" until pull-to-refresh (31). |
| 4 | Tick → check-in sent with the note; dashboard shows it | **PASS** | Tick `created:1, sent:1`; check-in SENT, attempt 1 SMS `fake-SMS-message-2`, attempt 2 VOICE PENDING +30 min. Body: `Hi Margaret, your family member is checking in on you today. Their note: "Remember your tablets, love from Sam" Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report.` Detail: Latest check-in Sent with timestamps (23). |
| 5 | Fake `YES` → resolved OK | **PASS** | `check_in_responded_ok`, check-in RESPONDED_OK, attempt 2 SKIPPED `superseded_by_response`. Detail "Current status: OK", Responded timestamp (24, 26). |
| 6 | Cascade exhaustion → NEEDS_ATTENTION and one sender notification | **PASS** | Second receiver "Harold" (API-created, consent YES). Attempt 1 aged 31 min and attempt 2 made due → tick `timedOut:1, sent:1` (VOICE `fake-VOICE-call-1`); attempt 2 aged → tick `timedOut:1, needsAttention:1`; re-run tick all zero. Exactly one `check_in.needs_attention {reason: cascade_exhausted}`, one `sender_push.not_delivered {attempted: 0}`, one `sender_voice_fallback.sent`. Outbound: VOICE call to the sender's own number with script `sender_escalation_siren_voice`. Dashboard after refresh: "Harold · Needs attention" (31); detail "Receiver did not respond" with Alert backup contacts / Try again later / Mark resolved (37). |
| 7 | Fake `HELP` with a backup contact → ESCALATED, English alert with the receiver's name; `DONE` → resolved | **PASS** | Backup contact "Ahmed" added through the inline form on the detail screen (26–29): list shows `Neighbour - *******4510`, "Instructions saved". Margaret's answered check-in moved back a day, tick created a new one. `HELP` → RESPONDED_HELP then ESCALATED; two `escalation_events` (SMS, WHATSAPP) SUCCESS; body `Hi Ahmed, this is Nearby. Margaret asked for help during a check-in from their family member. We reached them by SMS. Please contact them now. Where to find them: Flat 2, key under the mat Reply DONE once you have reached them.`; sender voice fallback `reason: help_response`. `DONE` from Ahmed → `check_in_resolved_by_backup`, RESOLVED. Detail "Current status: Resolved" with both timestamps (30). |
| 8 | Fake `REPORT` → paused, no check-in next tick; admin "reviewed safe" → unpaused | **PASS** | `REPORT` from Harold → `abuse_reported`; receiver `pausedUntil 9999-12-31`, `pausedReason abuse_report_pending_review`; `abuse_reports` PENDING; open check-in SKIPPED. Check-in aged a day, tick `created:0`. Test account provisioned as `SUPER_ADMIN` in the local `admin_users`; `GET /auth/admin/me` 200. Abuse Reports screen listed the report (33); "Mark safe" emptied the queue (34); DB `REVIEWED_SAFE`, pause cleared, audit `reviewed_safe {receiverResumed: true}`; next tick `created:1`. |
| 9 | Fake `STOP` between two attempts → remaining attempt SKIPPED | **PASS** | Third receiver "Priya" (API-created, consent YES). After the tick, `STOP` → `consent_revoked`; attempt 2 SKIPPED `receiver_opted_out`, check-in SKIPPED, `check_in.cancelled {skippedAttempts: 1}`, `opt_out_cooldowns` row (STOP, SMS, +7 days). Dashboard after refresh "Priya · Opted out" (31). |
| 10 | Free text, unknown number, short-code sender → 200 and an audit row | **PASS** | "Thanks, I am fine" from Margaret → 201 `unrecognised_reply`, audit `receiver.reply_unrecognised {bodyLength: 17}`; `+971509999999` → 201 `unknown_sender`, audit `inbound_reply.unknown_sender {senderHashPrefix}`; `12345` → 201 `invalid_sender`, audit `inbound_reply.invalid_sender`. Backend stayed up. |
| 11 | Timezone `Dubai` → 400; a valid receiver still gets its check-in | **PASS** | API create with `timezone: "Dubai"` → `400 {code: INVALID_TIMEZONE, message: "Receiver timezone must be an IANA time zone name such as Asia/Dubai"}`. Harold and Priya (valid) were created and got check-ins on the next tick. The in-app picker only offers valid zones. |
| 12 | Step-up (remove receiver / export) → OTP readable, entered in the app | **DEFECT D2 → FIXED → PASS** | Remove Priya: confirmation dialog (40), "Confirm receiver removal" OTP prompt (41), OTP `account_step_up_otp` to the sender's number readable on the outbound route and in the terminal. Verify → banner **"Step-up verification is required"**; receiver not deleted; challenge `verifiedAt` set but never consumed (42–43). Reproduced through the API with a valid token: `DELETE /receivers/:id` → 403. Root cause: `StepUpService` is provided only in `AccountModule`, which did not export it, and `ReceiversModule` did not import it, so `ReceiversController`'s `@Optional()` dependency was `undefined` in the real graph while the unit spec (fake injected) stayed green. Fixed in this PR (CB-070): `AccountModule` exports `StepUpService`, `ReceiversModule` imports `AccountModule`, `app.module.spec.ts` asserts the controller's optional collaborators resolve (red without the fix, green with it). After rebuild: API removal of Priya → 200, `deletedAt` set, token consumed, replay 403; app removal of Harold → dashboard shows only Margaret (53), audit `receiver.deleted` + `receiver.delete_notification_sent`, lifecycle SMS `receiver_checkins_ended` to Harold. Export data: OTP prompt (47), OTP read from outbound, Verify → Android share sheet with `family-checkin-data-2026-09-06.json` (48); challenge `EXPORT_DATA` consumed. |
| — | Sender actions on NEEDS_ATTENTION (not in the runbook) | **PASS** / **DEFECT D4** | "Mark resolved" → RESOLVED in app and DB, audit `check_in.resolved` (39). "Alert backup contacts" with no backups → audit `check_in.backup_alert_requested` + `escalation.no_backup_contacts` but **no visible feedback in the app**, and a siren voice call was placed to the sender themselves (`sender_voice_fallback.sent {reason: sender_requested}`). |
| — | Admin Operations (not in the runbook) | **PASS** / **DEFECT D7** | Summary with role, 24-hour status counts and recent check-ins (35); check-in detail with timeline, response "help" and cascade attempts (36). Priya's opted-out SKIPPED check-in is counted under the label "No backup available". |

Backend process: never restarted involuntarily; stderr empty; every request 2xx/4xx as expected. Terminal `[fake-provider]` lines
appeared for every send (CB-067 "done when" confirmed against the running process).

## Defects and findings

- **D1 (mobile, new CB-071)** — the dashboard fetches once and never refetches on focus: after consent, check-ins, REPORT and even
  after receivers were added through the API, the cards stayed stale until pull-to-refresh. A stale detail screen also let me tap
  Remove on an already-removed receiver with no feedback. `apps/mobile/src/app/(main)/index.tsx` has `RefreshControl` only;
  `useLovedOnes.ts` has no focus effect.
- **D2 (backend, CB-070, fixed here)** — every `DELETE /receivers/:id` returned 403 "Step-up verification is required" because
  `StepUpService` was not resolvable in `ReceiversModule`. Same class as the CB-003 finding: `@Optional()` seams hide missing
  providers from unit specs. The boot spec now asserts `ReceiversController.stepUpService`, `billingService` and
  `backupContactsService` are injected.
- **D3 (mobile copy, new CB-072)** — the sign-up form labels the sender's own number "Receiver phone" (the same label is reused for
  the backup contact's number on the detail screen); the sign-up error banner from a previous attempt stays visible after the
  email is edited.
- **D4 (product/backend, new CB-074)** — "Alert backup contacts" with zero backup contacts: no in-app message, and the sender-requested
  path also fires the sender siren (voice fallback with `reason: sender_requested`). Decide whether a sender-initiated alert should
  siren the sender at all.
- **D5 (data, new CB-075)** — `char(5)` language columns leak trailing spaces into API responses: `POST /auth/sync-user` returns
  `preferredLanguage: "en   "`, `POST /receivers` returns `language: "en   "`. Shares its root cause with CB-020.
- **D6 (mobile UX, new CB-073)** — the check-in window pickers list every minute of the day (reaching 18:00 from 11:00 is
  hundreds of scroll steps); the timezone picker shows fixed offsets ("United Kingdom, UTC+0" during BST). The backend receives the
  IANA name, so scheduling is correct; only the labels and ergonomics are off.
- **D7 (admin labels, new CB-077)** — status label mapping shows "No backup available" for a check-in SKIPPED because the receiver
  opted out; Admin Operations counted Priya's opt-out under that label.
- **D8 (legacy naming, extends CB-066)** — native splash and app name still "Family Check-In" (4); export file
  `family-checkin-data-<date>.json`.
- **D9 (mobile auth, new CB-078)** — Metro logs `WebCrypto API is not supported. Code challenge method will default to use plain
  instead of sha256` on every Supabase auth call in Expo Go: PKCE downgrades to `plain`. A development/store build must ship a
  crypto polyfill; verify before relying on PKCE (relates to CB-028/029).
- **D10 (voice, extends CB-022)** — the fake voice check-in call records `checkin_daily_voice` with `variables: {}`: the voice
  script gets no receiver name; only the pre-recorded audio path varies by language.
- **Observation** — the dashboard schedule chip reads "Daily at 9:00 AM" for a 09:00–11:00 window (start only); detail shows
  "Sms" for SMS.
- **Observation** — Expo Go on Android skipped push registration by design; no push was expected or observed.

## Cleanup and state left behind

- Emulator, Metro (`CI=1 expo start --android`, port 8081) and the backend (`node dist/main.js`, pid on 3000) were left running for
  the founder to look at; `docker rm -f nearby-dev-pg` resets the database. Local receivers in that database: Margaret (active),
  Harold and Priya (soft-deleted). The test account has an `admin_users` row and an `ACTIVE` subscription **in the throwaway
  database only**; nothing was written to the hosted Supabase project except normal sign-in activity.
- No repository files were changed by the run itself; the CB-070 fix and the documentation updates are in the PR that carries
  this report.
