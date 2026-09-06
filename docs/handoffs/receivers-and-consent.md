# Receivers and consent — feature handoff

Status: Built · Last verified: 2026-09-06 (emulator acceptance: add receiver, consent, STOP, REPORT, remove with OTP; acceptance run for the reply paths; specs for the cooldown, resend, quiet pushes, shared-phone and resolution-note paths; the app half — resend, resolution note, backup-alert outcome, typed error copy, schedule-invalid state — is covered by type-check, lint and the vitest project, emulator pass pending)
BRD: BRD-4, BRD-4.5, BRD-6.8, FR-SAF-04, FR-SAF-05, FR-SAF-07, FR-REC-07 · Open backlog: CB-036, CB-069

## What it does

- A sender adds a receiver (name, phone, country, relationship, language, timezone, tech profile, check-in window, optional ≤50-char personal note). The row is created with `consentStatus = PENDING` and a consent request goes out immediately on the receiver's primary channel. If the provider refuses the send, the row still exists, `consentRequestedAt` stays null and the response says `consentRequestStatus: "failed"` so the sender can resend.
- A phone that replied `STOP` cannot be added again by anyone until its 7-day cooldown lapses (409 `OPT_OUT_COOLDOWN`), and a phone another sender already monitors cannot be added a second time (409 `RECEIVER_ALREADY_MONITORED`; co-monitoring is a later BRD phase).
- The sender can resend the consent request to a `PENDING` receiver, at most one invitation per receiver per 7 days counting the first one (429 `CONSENT_RESEND_LIMIT` otherwise).
- The receiver replies `YES` to grant consent or `NO` to decline. No check-in is ever sent before `GRANTED`. A `YES` inside the STOP cooldown is ignored and audited.
- `STOP` revokes consent, writes a 7-day opt-out cooldown row, cancels any attempt still queued for today and sends the receiver one `receiver_checkins_ended` confirmation on the channel the STOP arrived on.
- Consent answers, STOP and a backup contact's DONE each send the sender a quiet push (default sound, no siren channel) deep-linking to the receiver.
- `REPORT` files an abuse report and pauses the receiver until an admin reviews it; the open check-in and its pending attempts are cancelled.
- The sender can pause (optionally until a date), resume, edit and remove a receiver. Remove is a soft delete behind an SMS step-up code; pause and remove send the receiver a best-effort lifecycle message.
- Resolving a check-in accepts an optional ≤200-character note, stored encrypted on the check-in and returned decrypted in receiver detail; the backup contact's DONE wording is appended to the same note.
- Mobile shows receivers on the dashboard with a consent/check-in status chip, and a detail screen with pause/resume, edit, backup contacts and remove. Both refetch on focus; a detail whose receiver was removed elsewhere says "This receiver was removed" and returns to the dashboard.
- The detail offers "Resend invitation" while consent is `PENDING`, takes an optional ≤200-character note on "Mark resolved" and shows the stored note, reports what "Alert backup contacts" achieved ("No backup contacts to alert — add one below", "Alerted N backup contact(s)", "Could not reach any backup contact"), and explains the typed 409/429 refusals in plain words with the relevant date (`describeBackendError` in `services/backendErrors.ts`). A create whose consent send failed lands on the detail with a notice pointing at Resend.
- A receiver whose stored timezone or window the scheduler cannot evaluate (`scheduleInvalidAt`, CB-069) shows a "Schedule needs attention" chip on the dashboard card and a warning on the detail that opens Edit; the consent/check-in status chip is unchanged.

## Where it lives

| Layer   | Paths                                                                                                                                                                                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend | `apps/backend/src/modules/receivers/` — `receivers.controller.ts`, `receivers.service.ts`, `receiver-consent.service.ts`, `receiver-reply.service.ts`, `receiver-replies.controller.ts`, `receiver-replies.module.ts`, `prisma-receivers.repository.ts`, `abuse-review-pause.ts`, `receiver-policy.ts` (cooldown/resend/retry constants and the typed 409/429 errors); quiet pushes via `apps/backend/src/modules/notifications/notifications.service.ts` (`sendQuietUpdateToUser`) |
| Mobile  | `apps/mobile/src/app/(main)/index.tsx` (dashboard), `apps/mobile/src/app/(main)/receivers/[id].tsx` (detail), `apps/mobile/src/app/(main)/receiver-setup.tsx` (re-exports `apps/mobile/src/app/(auth)/onboarding.tsx`), `apps/mobile/src/hooks/useLovedOnes.ts`, `apps/mobile/src/services/backendApi.ts` + `backendErrors.ts` (`describeBackendError`), `apps/mobile/src/utils/channelProfiles.ts`, `apps/mobile/src/utils/receiverStatus.ts` (status chip and the schedule-attention chip), `apps/mobile/src/utils/receiverActions.ts` (action notices, resolution-note check), `apps/mobile/src/utils/checkInSkipReason.ts`, `apps/mobile/src/components/onboarding/TimeSelect.tsx` + `utils/timeOptions.ts`, `TimezoneSelect.tsx` + `utils/timezoneOffset.ts` |
| Data    | `receivers`, `opt_out_cooldowns`, `abuse_reports`, `audit_logs`; migrations `202604260001_initial_nearby_schema`, `202605150001_receiver_remove_step_up`                                                                                                                                                   |
| Tests   | `receivers.controller.spec.ts`, `receivers.service.spec.ts`, `receiver-consent.service.spec.ts`, `receiver-reply.service.spec.ts`, `receiver-replies.controller.spec.ts`, `prisma-receivers.repository.spec.ts`; mobile `utils/receiverStatus.spec.ts`, `utils/receiverActions.spec.ts`, `utils/checkInSkipReason.spec.ts`, `utils/channelProfiles.spec.ts`, `utils/timeOptions.spec.ts`, `utils/timezoneOffset.spec.ts`, `services/backendApi.spec.ts`, `services/backendErrors.spec.ts` |

## Routes and contracts

All `/receivers` routes require a Supabase bearer token (`Authorization: Bearer <supabase access token>`), verified by `SupabaseAuthService`; the sender row is upserted from the identity on every call, and every query is scoped by `userId` + `deletedAt: null`.

- `GET /receivers` — sender; returns `{ receivers: ReceiverSummary[] }` for the sender's non-deleted receivers. Every summary carries `scheduleInvalidAt`: the ISO time the scheduler stamped the schedule unevaluable, or `null` (CB-069).
- `GET /receivers/:receiverId` — sender; detail plus `backupContacts` and an `escalation` summary. `latestCheckIn.resolutionNote` is the decrypted note when one exists; `scheduleInvalidAt` as above. 404 when missing, deleted or not owned.
- `POST /receivers` — sender **and** an entitled subscription; otherwise `403 { code: "PAID_ACCESS_REQUIRED" }`. Before anything is stored: `409 { code: "OPT_OUT_COOLDOWN", cooldownUntil }` while the phone's STOP cooldown runs, `409 { code: "RECEIVER_ALREADY_MONITORED" }` when another sender has an active (non-deleted) receiver with the same phone; both are audited as `receiver.create_rejected`. Creates the receiver `PENDING`, then calls `ReceiverConsentService.requestConsent`. Returns only non-sensitive fields plus `consentRequestStatus: "requested" | "failed"` — never name, phone, hashes or provider ids. `failed` means the provider refused the send; the row exists and the resend route applies.
- `POST /receivers/:receiverId/consent/resend` — sender; re-sends the consent request. `404` when not owned; `409 CONSENT_NOT_PENDING` unless `consentStatus = PENDING`; `409 OPT_OUT_COOLDOWN` during a cooldown; `429 { code: "CONSENT_RESEND_LIMIT", nextAllowedAt }` when the previous request (first one included) is less than 7 days old. Returns `{ receiver: { id, consentStatus, consentRequestStatus, consentRequestedAt } }`; a provider failure is `consentRequestStatus: "failed"` with `consentRequestedAt` unchanged. Audits `receiver.consent_resent` / `receiver.consent_resend_failed`.
- `PATCH /receivers/:receiverId` — sender; updates name, country, relationship, language, timezone, tech profile, channels and schedule. Phone is not editable. Schedule errors return `400 { code, message }`.
- `PATCH /receivers/:receiverId/pause` — sender; optional body `{ pausedUntil }` (ISO date; invalid → 400). Defaults to the indefinite sentinel `9999-12-31T23:59:59.999Z` with `pausedReason = "USER_PAUSED"`.
- `PATCH /receivers/:receiverId/resume` — sender; clears the pause.
- `DELETE /receivers/:receiverId` — sender **and** header `x-nearby-step-up-token`, consumed for `SensitiveAction.REMOVE_RECEIVER`; a missing header or an unavailable `StepUpService` is a 403. Soft-deletes (`deletedAt`).
- `PATCH /receivers/:receiverId/check-ins/:checkInId/{resolve,alert-backup,try-later}` — sender actions on the latest check-in; the cascade semantics belong to the check-in scheduler handoff. `resolve` accepts `{ note? }` (≤200 characters, else 400; blank means none), encrypted into `check_ins.resolutionNote`, audited only as `resolutionTextPresent`. `alert-backup` and `try-later` answer `409 { code: "CHECK_IN_IN_PROGRESS" }` while the latest check-in is `PENDING` or `SENT` (a second cascade would double-message the receiver); `try-later` schedules the retry `now + 120 min` (`TRY_LATER_RETRY_OFFSET_MINUTES`) and passes `retryOf` to `createPending`. `resolve` and `try-later` answer `{ receiver }`; `alert-backup` answers `{ receiver, backupAlert: { outcome, alerted, failed } }` with `outcome` one of `alerted`, `no_backup_contacts`, `all_failed` — the result `EscalationsService.escalateSenderRequestedBackup` returns, so the app can say what happened (CB-074).
- `POST /receiver-replies/fake` — **not** Supabase: `Authorization: Bearer <operations cron secret>`, and the controller is only registered when the channel provider mode is `fake` (404 otherwise). Body `{ fromPhone, channel, body, providerMessageId? }`.
- Real inbound replies arrive on `POST /provider-webhooks/{sms,whatsapp,twilio/messaging,twilio/voice}` (signature-checked; owned by the provider-webhooks feature) and call the same `ReceiverReplyService.handleInboundReply`.

### Reply keywords

The body is trimmed and upper-cased, then matched exactly:

- `YES` ← `YES`, `Y`, `1`, `OK`, `I'M FINE`, `IM FINE`, `I AM FINE`
- `NO` ← `NO`, `N`, `2`, `HELP`, `NEED HELP` (there is no separate HELP keyword; HELP is the `NO` branch)
- `STOP` ← `STOP` only · `REPORT` ← `REPORT` only · anything else → `UNKNOWN`
- Backup contacts (different sender phone) use `DONE` ← `DONE`, `CHECKED`, `RESOLVED`

### Consent state machine

`PENDING` (on create) → `GRANTED` | `DECLINED`; any state → `REVOKED`.

1. Sender phone that is not E.164 → `action: "invalid_sender"`, audited, no receiver touched.
2. Phone hash matches no active receiver → backup-contact path, else `action: "unknown_sender"`. When several non-deleted rows share the hash, the reply is resolved against the row with the most recent open check-in (`PENDING`/`SENT`/`NEEDS_ATTENTION`), else the most recently created row (`findActiveByPhoneHash`).
3. `REPORT` is evaluated first, at any consent status → `action: "abuse_reported"`; consent status is unchanged (the resolved row only).
4. If the resolved receiver is `GRANTED` and the reply is `YES`/`NO`, it is a check-in answer (`RESPONDED_OK` / `RESPONDED_HELP`, `NO` also escalates); with no open check-in the result is `action: "no_open_check_in"` and consent is untouched.
5. `YES` while the phone's STOP cooldown is running → `action: "consent_ignored_cooldown"`, audit `receiver.consent_ignored_cooldown` with `cooldownUntil`; nothing changes and no push goes out.
6. Otherwise the transition applies to **every** non-deleted row sharing the hash: `YES` → `GRANTED` + `consentGrantedAt`, `NO` → `DECLINED`, `STOP` → `REVOKED` + `consentRevokedAt` + an `opt_out_cooldowns` row per row (`cooldownUntil` = +7 days, keyword `STOP`) + `cancelOpenCheckInsForReceiver` per row + one `receiver_checkins_ended` confirmation to the phone on the inbound channel (`receiver.opt_out_confirmation_sent` / `_failed`, best effort). Each distinct sender then gets one quiet push (`reason`: `consent_granted`, `consent_declined`, `receiver_opted_out`).
7. `UNKNOWN` → `action: "unrecognised_reply"`, audit `receiver.reply_unrecognised`, HTTP 201.

Every transition encrypts the inbound transcript onto each receiver row and appends `receiver.consent_granted` / `consent_declined` / `consent_revoked` / `abuse_reported` per row. Quiet pushes audit `sender_push.sent` / `sender_push.not_delivered` / `sender_push.failed` with `reason` and `deepLink` on the receiver (or on the check-in for `backup_contact_done`).

## How to exercise it locally (fake mode)

With the backend on fake providers per `docs/EMULATOR_RUNBOOK.md` (`$h` = the operations cron bearer header):

1. Add a receiver in the app (or `POST /receivers` with a Supabase token) — the fake consent request is sent and `consentRequestedAt` is set.
2. `Invoke-RestMethod -Method Post -Uri http://localhost:3000/receiver-replies/fake -Headers $h -Body '{"fromPhone":"+971500000001","channel":"SMS","body":"YES"}'` → `{"action":"consent_granted","consentStatus":"GRANTED"}`.
3. `POST /operations/check-ins/run` to create a check-in, then reply `YES` (resolves OK) or `HELP` (escalates).
4. Reply `STOP` between two attempts → remaining attempts `SKIPPED`, `opt_out_cooldowns` row written, a `receiver_checkins_ended` confirmation appears in `GET /receiver-replies/fake/outbound`, and `sender_push.not_delivered {reason:"receiver_opted_out"}` is audited (no device token registered).
5. Reply `YES` straight after the STOP → `{"action":"consent_ignored_cooldown","consentStatus":"REVOKED"}`. Adding the same phone again from the app → `409 OPT_OUT_COOLDOWN` with `cooldownUntil`.
6. `POST /receivers/<id>/consent/resend` with the Supabase bearer on a fresh `PENDING` receiver → `429 CONSENT_RESEND_LIMIT` (the create already sent one this week); on a receiver whose create returned `consentRequestStatus: "failed"` → 200 and the fake consent message.
7. Reply `REPORT` → receiver paused for review, no new check-in on the next tick; admin "reviewed safe" unpauses.
8. Free text (`"Thanks, I'm fine"`), an unknown number and a short code all return 201 with `unrecognised_reply` / `unknown_sender` / `invalid_sender`.

## Invariants — do not break

- No check-in is created or sent unless `consentStatus = GRANTED`, `deletedAt` is null and the receiver is not paused (`CheckInsService.isEligible`, `PrismaCheckInsRepository.findReceiversDueForCheckIn`).
- Inbound replies must never 500. Unparseable senders, unknown phones and free text are audited and answered 200/201; the provider must not retry.
- The abuse review pause is `pausedUntil = 9999-12-31T00:00:00.000Z` **plus** `pausedReason = "abuse_report_pending_review"` (`abuse-review-pause.ts`). The scheduler decides eligibility from `pausedUntil` alone, and the admin unpause clears it only while that reason still matches, so a sender's own `USER_PAUSED` pause is never cleared by a review.
- `REPORT` is matched before the consent and check-in branches; a reported receiver must not have its consent silently changed by the same message.
- STOP, REPORT, sender pause and sender delete all call `cancelOpenCheckInsForReceiver` — an opt-out must stop a cascade that is already mid-flight (CB-008).
- `requestConsent` throws when `consentRequestedAt` is already set; only `resendConsent` may send again, and only for a `PENDING` receiver at least 7 days after the previous request (`CONSENT_REQUEST_MIN_INTERVAL_DAYS`). A provider failure in either path never sets `consentRequestedAt`, so a receiver who never got the message can always be re-invited.
- The opt-out cooldown is read by `phoneHash` across every row that ever had the phone, deleted rows included (`findOptOutCooldownByPhoneHash`): deleting and re-adding a receiver who said STOP must not skip the 7 days (FR-SAF-07). Create, resend and the YES transition all consult it.
- One phone, one sender: `POST /receivers` refuses a phone another sender holds on a non-deleted row (even `REVOKED` or `DECLINED`). Reply resolution and consent fan-out exist for rows that already share a hash (same sender, or pre-existing data), not to enable co-monitoring.
- Quiet pushes and the STOP confirmation are best effort and run after the state change: a push gateway or provider failure is audited (`sender_push.failed`, `receiver.opt_out_confirmation_failed`) and never fails the inbound reply (CB-015). Push copy never contains the receiver's name or phone.
- `try-later` and `alert-backup` must not start a second cascade while the latest check-in is `PENDING` or `SENT`; that is the 409, not a 404.
- `alert-backup` returns the fan-out's own `{ outcome, alerted, failed }` next to the refreshed receiver; the app shows that and never infers "no backup contacts" from an unchanged status (CB-074).
- `scheduleInvalidAt` is surfaced verbatim from the row on every summary and detail (`null` when clear). The app renders it as a separate "Schedule needs attention" chip/warning and never in place of the consent or check-in status; the scheduler owns setting and clearing it (check-in engine handoff).
- Typed refusals (`OPT_OUT_COOLDOWN`, `RECEIVER_ALREADY_MONITORED`, `CHECK_IN_IN_PROGRESS`, `CONSENT_NOT_PENDING`, `CONSENT_RESEND_LIMIT`) keep their `code` and details (`cooldownUntil`, `nextAllowedAt`) in the body; the app's `describeBackendError` depends on those names.
- The resolution note is encrypted like every other free text; audit rows carry only `resolutionTextPresent` / `resolutionTextStored` (the audit PII guard rejects any key containing `note`).
- Receiver PII (name, phone, personal note, consent and reply transcripts, report content) is encrypted; phones are matched only through `CryptoService.hashForLookup`. Audit metadata carries channel, template key, provider status and counts — never raw PII.
- Delete is a soft delete scoped by `userId + receiverId + deletedAt: null`; the repository preloads the row first because the normal detail lookup excludes deleted receivers.
- `POST /receivers` checks entitlement before creating anything; `DELETE /receivers/:id` refuses without a consumed step-up token.
- Pause and delete lifecycle notifications are best effort: a channel failure is audited and must not fail the sender's action.
- `POST /receiver-replies/fake` runs the real reply pipeline, so it stays fake-mode-only and behind the cron secret.

## Known gaps

- CB-036 — receiver detail lacks 30-day history, escalation list and time-since-last-contact; pause has no end-date picker in the app.
- CB-069 — the audit-once stamp and the app's "Schedule needs attention" state are done; the sender quiet push for an invalid schedule (via CB-012) is still pending.
- The wave-B mobile changes (resend, resolution note, backup-alert outcome, typed error copy, schedule chip) have not been driven through the emulator yet; they are on the post-sprint-2 runbook pass.
- `REPORT` is applied to the resolved row only; with several rows sharing a phone, the other rows are not paused for review.
- The STOP confirmation reuses `receiver_checkins_ended` ("has ended your Nearby check-ins"); a dedicated opt-out template is a CB-010 copy slice.

## Known gaps (added after the sprint-2 acceptance run)

- CB-079 — the STOP confirmation still uses the neutral English fallback inside non-English copy and never names the sender.
- CB-081 — resend counts the first invitation toward the 7-day cap (founder decision pending).
- CB-080 — intermittent empty response bodies on the Android app (verify and delete flows affected); see `docs/audits/2026-09-06/sprint2-acceptance.md` F2.

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` §0a (lines 793–804), §5 (lines 928–1179), §6 (lines 1180–1257), §29f (lines 2439–2476).
- Acceptance evidence: `docs/audits/2026-09-06/sprint1-acceptance.md` S4 (unrecognised/unknown/invalid replies), S6 (STOP), S7 (REPORT and admin unpause).
- PRs: #17 (REPORT pause and unpause, replies never 500), #18 (fake reply route gated to fake mode plus the cron secret), #19 (consent request rendered from the message catalog), #20 (STOP/REPORT/pause/delete cancel in-flight attempts), #24 (CB-070: `DELETE /receivers/:id` could never consume a step-up token in the real graph), #25 (CB-071 dashboard and detail refetch on focus, removed-receiver feedback; CB-072 phone labels; CB-073 quarter-hour pickers and live offsets; CB-077 skipped-status labels), #27 (CB-009 cooldown enforced on create/resend/YES plus `POST /receivers/:id/consent/resend`; CB-012 quiet sender pushes and STOP confirmation; CB-014 one phone per sender, reply resolution and consent fan-out over shared hashes; CB-017 try-later at +120 min and `CHECK_IN_IN_PROGRESS`; CB-018 encrypted resolution note), #30 (sprint-2 wave B receivers API/app follow-ups — CB-074 app half: `alert-backup` answers `backupAlert` and the detail shows it; CB-069 `scheduleInvalidAt` on summaries and detail with the dashboard chip and detail warning; mobile resend, resolution note, `describeBackendError` copy for the typed codes, failed-consent hand-off from the add form).
- Emulator acceptance 2026-09-06: `docs/audits/2026-09-06/emulator-acceptance.md` (scenarios 2–5, 8–12; findings CB-071, CB-072, CB-073, CB-074, CB-075).
