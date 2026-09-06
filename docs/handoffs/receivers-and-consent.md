# Receivers and consent — feature handoff

Status: Partially built · Last verified: 2026-09-06 (emulator acceptance: add receiver, consent, STOP, REPORT, remove with OTP; acceptance run for the reply paths; specs for the rest)
BRD: BRD-4, BRD-4.5, BRD-6.8, FR-SAF-04, FR-SAF-05, FR-SAF-07, FR-REC-07 · Open backlog: CB-009, CB-012, CB-014, CB-017, CB-018, CB-036, CB-069

## What it does

- A sender adds a receiver (name, phone, country, relationship, language, timezone, tech profile, check-in window, optional ≤50-char personal note). The row is created with `consentStatus = PENDING` and a consent request goes out immediately on the receiver's primary channel.
- The receiver replies `YES` to grant consent or `NO` to decline. No check-in is ever sent before `GRANTED`.
- `STOP` revokes consent, writes a 7-day opt-out cooldown row and cancels any attempt still queued for today.
- `REPORT` files an abuse report and pauses the receiver until an admin reviews it; the open check-in and its pending attempts are cancelled.
- The sender can pause (optionally until a date), resume, edit and remove a receiver. Remove is a soft delete behind an SMS step-up code; pause and remove send the receiver a best-effort lifecycle message.
- Mobile shows receivers on the dashboard with a consent/check-in status chip, and a detail screen with pause/resume, edit, backup contacts and remove.

## Where it lives

| Layer   | Paths                                                                                                                                                                                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend | `apps/backend/src/modules/receivers/` — `receivers.controller.ts`, `receivers.service.ts`, `receiver-consent.service.ts`, `receiver-reply.service.ts`, `receiver-replies.controller.ts`, `receiver-replies.module.ts`, `prisma-receivers.repository.ts`, `abuse-review-pause.ts`                             |
| Mobile  | `apps/mobile/src/app/(main)/index.tsx` (dashboard), `apps/mobile/src/app/(main)/receivers/[id].tsx` (detail), `apps/mobile/src/app/(main)/receiver-setup.tsx` (re-exports `apps/mobile/src/app/(auth)/onboarding.tsx`), `apps/mobile/src/hooks/useLovedOnes.ts`, `apps/mobile/src/utils/channelProfiles.ts`, `apps/mobile/src/utils/receiverStatus.ts` |
| Data    | `receivers`, `opt_out_cooldowns`, `abuse_reports`, `audit_logs`; migrations `202604260001_initial_nearby_schema`, `202605150001_receiver_remove_step_up`                                                                                                                                                   |
| Tests   | `receivers.controller.spec.ts`, `receivers.service.spec.ts`, `receiver-consent.service.spec.ts`, `receiver-reply.service.spec.ts`, `receiver-replies.controller.spec.ts`, `prisma-receivers.repository.spec.ts`; mobile `utils/receiverStatus.spec.ts`, `utils/channelProfiles.spec.ts`, `services/backendApi.spec.ts` |

## Routes and contracts

All `/receivers` routes require a Supabase bearer token (`Authorization: Bearer <supabase access token>`), verified by `SupabaseAuthService`; the sender row is upserted from the identity on every call, and every query is scoped by `userId` + `deletedAt: null`.

- `GET /receivers` — sender; returns `{ receivers: ReceiverSummary[] }` for the sender's non-deleted receivers.
- `GET /receivers/:receiverId` — sender; detail plus `backupContacts` and an `escalation` summary. 404 when missing, deleted or not owned.
- `POST /receivers` — sender **and** an entitled subscription; otherwise `403 { code: "PAID_ACCESS_REQUIRED" }`. Creates the receiver `PENDING`, then calls `ReceiverConsentService.requestConsent`. Returns only non-sensitive fields plus `consentRequestStatus: "requested"` — never name, phone, hashes or provider ids.
- `PATCH /receivers/:receiverId` — sender; updates name, country, relationship, language, timezone, tech profile, channels and schedule. Phone is not editable. Schedule errors return `400 { code, message }`.
- `PATCH /receivers/:receiverId/pause` — sender; optional body `{ pausedUntil }` (ISO date; invalid → 400). Defaults to the indefinite sentinel `9999-12-31T23:59:59.999Z` with `pausedReason = "USER_PAUSED"`.
- `PATCH /receivers/:receiverId/resume` — sender; clears the pause.
- `DELETE /receivers/:receiverId` — sender **and** header `x-nearby-step-up-token`, consumed for `SensitiveAction.REMOVE_RECEIVER`; a missing header or an unavailable `StepUpService` is a 403. Soft-deletes (`deletedAt`).
- `PATCH /receivers/:receiverId/check-ins/:checkInId/{resolve,alert-backup,try-later}` — sender actions on the latest check-in; the semantics belong to the check-in scheduler handoff.
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
2. Phone hash matches no active receiver → backup-contact path, else `action: "unknown_sender"`.
3. `REPORT` is evaluated first, at any consent status → `action: "abuse_reported"`; consent status is unchanged.
4. If the receiver is `GRANTED` and the reply is `YES`/`NO`, it is a check-in answer (`RESPONDED_OK` / `RESPONDED_HELP`, `NO` also escalates); with no open check-in the result is `action: "no_open_check_in"` and consent is untouched.
5. Otherwise `YES` → `GRANTED` + `consentGrantedAt`, `NO` → `DECLINED`, `STOP` → `REVOKED` + `consentRevokedAt` + an `opt_out_cooldowns` row (`cooldownUntil` = +7 days, keyword `STOP`).
6. `UNKNOWN` → `action: "unrecognised_reply"`, audit `receiver.reply_unrecognised`, HTTP 201.

Every transition encrypts the inbound transcript onto the receiver and appends `receiver.consent_granted` / `consent_declined` / `consent_revoked` / `abuse_reported`.

## How to exercise it locally (fake mode)

With the backend on fake providers per `docs/EMULATOR_RUNBOOK.md` (`$h` = the operations cron bearer header):

1. Add a receiver in the app (or `POST /receivers` with a Supabase token) — the fake consent request is sent and `consentRequestedAt` is set.
2. `Invoke-RestMethod -Method Post -Uri http://localhost:3000/receiver-replies/fake -Headers $h -Body '{"fromPhone":"+971500000001","channel":"SMS","body":"YES"}'` → `{"action":"consent_granted","consentStatus":"GRANTED"}`.
3. `POST /operations/check-ins/run` to create a check-in, then reply `YES` (resolves OK) or `HELP` (escalates).
4. Reply `STOP` between two attempts → remaining attempts `SKIPPED`, `opt_out_cooldowns` row written.
5. Reply `REPORT` → receiver paused for review, no new check-in on the next tick; admin "reviewed safe" unpauses.
6. Free text (`"Thanks, I'm fine"`), an unknown number and a short code all return 201 with `unrecognised_reply` / `unknown_sender` / `invalid_sender`.

## Invariants — do not break

- No check-in is created or sent unless `consentStatus = GRANTED`, `deletedAt` is null and the receiver is not paused (`CheckInsService.isEligible`, `PrismaCheckInsRepository.findReceiversDueForCheckIn`).
- Inbound replies must never 500. Unparseable senders, unknown phones and free text are audited and answered 200/201; the provider must not retry.
- The abuse review pause is `pausedUntil = 9999-12-31T00:00:00.000Z` **plus** `pausedReason = "abuse_report_pending_review"` (`abuse-review-pause.ts`). The scheduler decides eligibility from `pausedUntil` alone, and the admin unpause clears it only while that reason still matches, so a sender's own `USER_PAUSED` pause is never cleared by a review.
- `REPORT` is matched before the consent and check-in branches; a reported receiver must not have its consent silently changed by the same message.
- STOP, REPORT, sender pause and sender delete all call `cancelOpenCheckInsForReceiver` — an opt-out must stop a cascade that is already mid-flight (CB-008).
- `requestConsent` throws when `consentRequestedAt` is already set: one consent request per receiver, and duplicates must stay impossible.
- Receiver PII (name, phone, personal note, consent and reply transcripts, report content) is encrypted; phones are matched only through `CryptoService.hashForLookup`. Audit metadata carries channel, template key, provider status and counts — never raw PII.
- Delete is a soft delete scoped by `userId + receiverId + deletedAt: null`; the repository preloads the row first because the normal detail lookup excludes deleted receivers.
- `POST /receivers` checks entitlement before creating anything; `DELETE /receivers/:id` refuses without a consumed step-up token.
- Pause and delete lifecycle notifications are best effort: a channel failure is audited and must not fail the sender's action.
- `POST /receiver-replies/fake` runs the real reply pipeline, so it stays fake-mode-only and behind the cron secret.

## Known gaps

- CB-009 — the opt-out cooldown is written but never read; there is no consent re-invite, and a failed consent send strands the receiver as `PENDING` forever.
- CB-012 — no quiet sender push on consent granted/declined or opt-out, and the receiver gets no STOP confirmation.
- CB-014 — the same phone under two senders attaches replies and consent to whichever row `findFirst` returns; create does not 409.
- CB-017 — try-later retries in 15 minutes instead of 2 hours and is allowed while a cascade is still `SENT`.
- CB-018 — the resolution note is never stored and the backup contact's reply text is not captured.
- CB-036 — receiver detail lacks 30-day history, escalation list and time-since-last-contact; pause has no end-date picker in the app.
- CB-069 — `check_in.schedule_invalid` is audited on every tick for a receiver with a bad timezone or window, and the sender is never told.

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` §0a (lines 793–804), §5 (lines 928–1179), §6 (lines 1180–1257), §29f (lines 2439–2476).
- Acceptance evidence: `docs/audits/2026-09-06/sprint1-acceptance.md` S4 (unrecognised/unknown/invalid replies), S6 (STOP), S7 (REPORT and admin unpause).
- PRs: #17 (REPORT pause and unpause, replies never 500), #18 (fake reply route gated to fake mode plus the cron secret), #19 (consent request rendered from the message catalog), #20 (STOP/REPORT/pause/delete cancel in-flight attempts), #24 (CB-070: `DELETE /receivers/:id` could never consume a step-up token in the real graph).
- Emulator acceptance 2026-09-06: `docs/audits/2026-09-06/emulator-acceptance.md` (scenarios 2–5, 8–12; findings CB-071, CB-072, CB-073, CB-074, CB-075).
