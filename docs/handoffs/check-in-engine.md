# Scheduled check-in engine — feature handoff

Status: Built · Last verified: 2026-09-06 (acceptance run — S2/S6/S8; sender actions and voice caller-ID: specs; local-day dedupe, schedule-invalid stamp and quiet push, `checkin_retry`, delivery-status failure and sender display name: specs plus migrations `202609060101`, `202609060201`, `202609060202` replayed on a throwaway Postgres with `db:apply-all`, `db:check-invariants` and `db:drift-check` green)
BRD: BRD-4.3, BRD-6.2, FR-CSC-01, FR-CSC-03, FR-CSC-04, FR-CSC-07, FR-REC-06 · Open backlog: CB-017, CB-045, CB-053, CB-057, CB-060, CB-069 (receiver-card state only, mobile)

## What it does

- Creates one `PENDING` check-in per granted, non-paused, non-deleted, entitled receiver whose `scheduleTimeWindow` is open in the receiver's own IANA timezone, at most once per receiver-local day (`check_ins.scheduledLocalDate`, CB-013). A window that wraps past local midnight (`22:00`–`06:00`) counts as the day it opened.
- Writes the whole channel cascade up front as `check_in_attempts` rows with staggered `scheduledAt`, sends attempt 1 immediately, and marks the check-in `SENT`.
- On each later tick, times out attempts whose response window has elapsed and sends the next attempt that is already due; a future attempt keeps the check-in open instead of ending it. Attempt 2 onwards is rendered from `checkin_retry` ("we have not heard back from you yet"); voice attempts keep `checkin_daily_voice` (CB-010). Every message names the receiver and the sender (`senderDisplayName` from `users.displayNameEncrypted` through `UsersService`, "your family member" when none is stored).
- When Twilio reports an SMS or WhatsApp message `undelivered` or `failed` (the signed `/provider-webhooks/twilio/messaging/status` callback), the SENT attempt becomes `FAILED` (`twilio_status_<status>`) at once, the next pending attempt is pulled forward to "now", and the next tick sends it — the cascade no longer waits 15–30 minutes for a message the carrier already gave up on (CB-016).
- Stamps a receiver whose stored `timezone` or `scheduleTimeWindow` cannot be evaluated (`receivers.scheduleInvalidAt`), audits `check_in.schedule_invalid` once per schedule version, not once per tick, and sends the sender one quiet push ("Check-in schedule needs attention", deep link to the receiver) from the same tick (CB-069).
- When no attempt is left the check-in becomes `NEEDS_ATTENTION` and the sender is notified once (siren push, voice fallback) — see `docs/handoffs/escalations-and-notifications.md`.
- Cancels every open check-in and every pending attempt of a receiver on STOP, REPORT, pause or delete.
- Gives the sender three actions on an actionable check-in: retry later, alert backup contacts, mark resolved.
- Picks a sticky per-receiver voice caller ID from a country-matched pool for `VOICE` attempts.

## Where it lives

| Layer   | Paths                                                                                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend | `apps/backend/src/modules/check-ins/` (service, repository, voice caller-ID repository, module); `apps/backend/src/modules/operations/operations.controller.ts`; `apps/backend/src/shared/schedule/receiver-schedule.ts`; sender actions in `apps/backend/src/modules/receivers/receivers.service.ts` + `receivers.controller.ts`; delivery-status and voice callbacks arrive through `apps/backend/src/modules/provider-webhooks/provider-webhooks.controller.ts`; the sender name comes from `apps/backend/src/modules/users/users.service.ts` |
| Mobile  | `apps/mobile/src/app/(main)/receivers/[id].tsx`; `apps/mobile/src/services/backendApi.ts`                                                                                                                   |
| Ops     | `.github/workflows/operations-check-ins.yml`; `apps/backend/scripts/run-operations-check-ins.ts`; `apps/backend/src/modules/operations/operations-runner.ts`; npm script `operations:check-ins`             |
| Data    | `check_ins` (`scheduledLocalDate` DATE NOT NULL, `retryOf` UUID NULL, partial unique index `check_ins_receiverId_scheduledLocalDate_key` WHERE `retryOf IS NULL`), `check_in_attempts`, `receivers.scheduleInvalidAt`, `voice_caller_id_pool`, `receiver_voice_caller_id_assignments`; migrations `202604260001_initial_nearby_schema`, `202605010001_check_in_attempts`, `202605100001_twilio_voice_readiness`, `202609060101_check_in_local_date_and_schedule_invalid` |
| Tests   | `check-ins.service.spec.ts`, `prisma-check-ins.repository.spec.ts`, `prisma-voice-caller-id.repository.spec.ts`, `operations.controller.spec.ts`, `operations-runner.spec.ts`, `receiver-schedule.spec.ts`, `receivers.service.spec.ts`, `receivers.controller.spec.ts` |

## Routes and contracts

- `POST /operations/check-ins/run` — scheduler only. `Authorization: Bearer <OPERATIONS_CRON_SECRET>`, compared timing-safely by `assertBearerSecret` (`apps/backend/src/shared/auth/bearer-secret.ts`); missing or wrong bearer is `401 "Operations cron bearer token is required"`. Carries `@SkipThrottle()` because the scheduler calls it in bursts. Runs `sendDueCheckIns()` then `processCascadeAttempts()` and returns aggregate counts only: `{ ok: true, dueCheckIns: { created, sent, skipped, failed }, cascadeAttempts: { sent, timedOut, failed, needsAttention, skipped } }` — no receiver ids, check-in ids, provider ids, names, phones or bodies. `dueCheckIns.skipped` covers ineligible and unpaid receivers plus a receiver whose local day an overlapping tick already claimed; `dueCheckIns.failed` counts a receiver with an unevaluable schedule on every tick even though it is audited once.
- `PATCH /receivers/:receiverId/check-ins/:checkInId/resolve` — sender Supabase bearer. Only when the receiver's latest check-in is that id and its status is `RESPONDED_HELP`, `ESCALATED`, `NEEDS_ATTENTION`, `FAILED` or `SKIPPED`; sets `RESOLVED`, `resolvedAt`, `resolutionByUserId`, audits `check_in.resolved` (metadata: `receiverId`), returns `{ receiver }`; otherwise `404`.
- `PATCH /receivers/:receiverId/check-ins/:checkInId/alert-backup` — sender Supabase bearer. Actionable from `RESPONDED_HELP`, `NEEDS_ATTENTION`, `FAILED`, `SKIPPED`; audits `check_in.backup_alert_requested` then delegates to `EscalationsService.escalateSenderRequestedBackup`.
- `PATCH /receivers/:receiverId/check-ins/:checkInId/try-later` — sender Supabase bearer. Actionable from `SENT`, `RESPONDED_HELP`, `NEEDS_ATTENTION`, `FAILED`, `SKIPPED`; creates a **new** `PENDING` check-in at `now + 15 min` with its own cascade and audits `check_in.try_later_requested` (`retryAt` in metadata). It does not change the status of the check-in it was invoked on. The row must be created with `retryOf` set (see Known gaps) or it collides with the day's real check-in.
- `GET /operations/check-ins/summary` and `GET /operations/check-ins/:checkInId` share the controller but belong to the admin operations-visibility surface, not this feature.
- `POST /provider-webhooks/twilio/messaging/status` (owned by `docs/handoffs/channels-and-providers.md`) calls `CheckInsService.recordMessagingProviderStatus({ providerMessageId, messageStatus, errorCode })`. Only `undelivered` and `failed` act: `markSentAttemptProviderFailure` (SENT → FAILED, `providerStatus` = the Twilio status, `failureReason: twilio_status_<status>`), one `check_in.attempt_failed` audit row (`receiverId`, `channel`, `attemptNumber`, `failureReason`, `providerErrorCode` when Twilio sent one), then — only while the check-in is still open — `expediteNextPendingAttempt` and `flagIfExhausted`. Returns `{ updated }`; anything else, or a `MessageSid` no SENT attempt carries, is `{ updated: false }` and changes nothing.

### Constants in the code

`apps/backend/src/modules/check-ins/check-ins.service.ts`, `buildCascadeAttempts`:

- `TechProfile.VOICE_ONLY` / `TechProfile.LANDLINE` → three `VOICE` attempts at `[0, 15, 45]` minutes after `scheduledAt`.
- Otherwise the channel list is `[primaryChannel, ...fallbackChannels]` deduped, and the offset for index `i` is `0` when `i === 0`, else `previous === Channel.WHATSAPP ? 15 : index === 1 ? 30 : 45` minutes.

`isAttemptTimedOut` in the same file holds the response window: `const windowMinutes = attempt.channel === Channel.WHATSAPP ? 15 : 30;` — an attempt is timed out once `sentAt + windowMinutes <= now`. Both the offsets and the window are inline literals, not named constants (CB-057).

The sender retry offset is `15 * 60 * 1000` in `receivers.service.ts` (`tryCheckInLaterForSender`); the BRD figure is 2 hours (CB-017).

### Local day and daily dedupe (CB-013)

`apps/backend/src/shared/schedule/receiver-schedule.ts` owns the clock arithmetic: `localClockInTimeZone(now, tz)` reads the receiver's date and minutes with one `Intl.DateTimeFormat` call (DST and far-side-of-UTC zones come from the platform zone data), `isInsideScheduleWindow(window, minutes)` evaluates the window, `scheduleDayOf(clock, window)` returns the `YYYY-MM-DD` the check-in belongs to (the previous date for the small hours of a wrapping window), and `localDateInTimeZone(instant, tz)` is the plain local date for callers outside the cron.

`PrismaCheckInsRepository.findReceiversDueForCheckIn` loads every granted `daily` receiver, evaluates each one, and for the receivers whose window is open runs one `check_ins.findMany({ where: { retryOf: null, OR: [{ receiverId, scheduledLocalDate }, …] } })`; a receiver with a matching row is not a candidate. Each candidate carries `scheduledLocalDate`, which the service passes to `createPending`. The `DATE` column travels through Prisma as a `Date` at UTC midnight (`toDateColumn` / `fromDateColumn`); records expose it as a `YYYY-MM-DD` string.

`createPending({ receiverId, scheduledAt, scheduledLocalDate?, retryOf? })` defaults `scheduledLocalDate` to the UTC calendar day of `scheduledAt` and `retryOf` to `null`. A unique-index violation (`P2002`) becomes `CheckInAlreadyScheduledError`; `sendDueCheckIns` counts it as `skipped` and continues.

Migration `202609060101` backfills `scheduledLocalDate` with `"scheduledAt"::date` (the UTC day the rows were deduped on — a per-row `AT TIME ZONE receiver.timezone` would abort on any stored zone Postgres cannot resolve, and a `timestamptz::date` cast follows the session TimeZone), then parents any pre-existing same-day duplicates to the earliest row via `retryOf` before building the index. Prisma cannot express a partial index, so the index lives only in that migration; `db:drift-check` confirmed Prisma's introspection ignores it (no diff).

### Status machine

`CheckInStatus`: `PENDING SENT RESPONDED_OK RESPONDED_HELP ESCALATED NEEDS_ATTENTION RESOLVED FAILED SKIPPED`.
`CheckInAttemptStatus`: `PENDING SENT RESPONDED FAILED TIMED_OUT SKIPPED`.

Every write is an `updateMany` filtered by `status: { in: allowedFrom }` (`transitionCheckIn` / `transitionAttempt` in `prisma-check-ins.repository.ts`), returning `true` only when a row actually moved. `CHECK_IN_ALLOWED_FROM` / `CHECK_IN_ATTEMPT_ALLOWED_FROM` live in `check-ins.repository.ts`:

| Write | From |
| --- | --- |
| `markSent` → `SENT` | `PENDING`, `SENT` |
| `markNeedsAttention` → `NEEDS_ATTENTION` | `PENDING`, `SENT` |
| `markCancelled` → `SKIPPED` | `PENDING`, `SENT` |
| `markResponded` → `RESPONDED_OK` / `RESPONDED_HELP` | `PENDING`, `SENT`, `NEEDS_ATTENTION` |
| `markResolvedByBackupContact` → `RESOLVED` | `RESPONDED_HELP`, `ESCALATED`, `NEEDS_ATTENTION`, `FAILED`, `SKIPPED` |
| attempt `markAttemptSent` → `SENT` | `PENDING` |
| attempt `markAttemptFailed` → `FAILED` | `PENDING`, `SENT` |
| attempt `markSentAttemptProviderFailure` → `FAILED` | `SENT` |
| attempt `markAttemptTimedOut` → `TIMED_OUT` (`failureReason: 'response_window_elapsed'`) | `SENT` |
| attempt `expediteNextPendingAttempt` → `PENDING` with `scheduledAt = now` (earliest pending attempt of the check-in, only when scheduled later) | `PENDING` |
| attempt `markLatestSentAttemptResponded` → `RESPONDED` | `SENT` |
| attempt `skipPendingAttemptsForCheckIn` → `SKIPPED` | `PENDING` |

There is no `CANCELLED` status: cancellation writes `SKIPPED` with the reason on the attempts (`receiver_opted_out`, `abuse_reported`, `receiver_paused`, `receiver_deleted`).

## How to exercise it locally (fake mode)

- Follow `docs/EMULATOR_RUNBOOK.md` sections 1–5 (fake providers, backend on port 3000).
- Tick: `Invoke-RestMethod -Method Post -Uri http://localhost:3000/operations/check-ins/run -Headers @{ Authorization = 'Bearer <OPERATIONS_CRON_SECRET>' }`.
- Reply as the receiver through `POST /receiver-replies/fake` (fake mode only, same cron-secret bearer).
- To watch the cascade exhaust without waiting, age `check_in_attempts.sentAt` past the response window in the database and run the tick again; repeat until `cascadeAttempts.needsAttention` is 1.
- The per-local-day dedupe means a second tick creates nothing for the same receiver; move the existing `check_ins.scheduledLocalDate` (and `scheduledAt`) back a day to test the next creation. A row with `retryOf` set never blocks the day.
- To read the retry copy, age attempt 1's `sentAt` past its window and tick: attempt 2's `[fake-provider]` line (and `GET /receiver-replies/fake/outbound`) shows `checkin_retry` — "Hi …, we have not heard back from you yet."
- To see the once-only schedule audit, set a receiver's `timezone` to `Dubai` in the database and tick twice: one `check_in.schedule_invalid` audit row, one `sender_push.sent` / `not_delivered` row on the receiver with `reason: "schedule_invalid"` and `deepLink: "/(main)/receivers/<id>"` (no device token registered → `not_delivered`; no voice fallback for this quiet push), `receivers.scheduleInvalidAt` set, `dueCheckIns.failed` 1 on both ticks. Restore the timezone and tick: the stamp is null again and the next bad version audits and pushes afresh.
- To see a delivery failure advance the cascade without waiting, send a check-in, then post a signed `MessageStatus=undelivered` for attempt 1's `providerMessageId` to `/provider-webhooks/twilio/messaging/status` (recipe in `docs/handoffs/channels-and-providers.md`) and tick: attempt 1 is `FAILED` (`twilio_status_undelivered`), attempt 2's `scheduledAt` is the callback time and the tick reports `cascadeAttempts.sent: 1`.
- Focused specs: `npm.cmd --prefix apps/backend test -- src/modules/check-ins/ src/modules/operations/ src/shared/schedule/`.

## Invariants — do not break

- Every status write goes through the `allowedFrom` guards and callers treat `false` as "someone else closed this first": no audit, no notification, no reopen (CB-006). Never replace them with a read-then-write.
- `markCheckInNeedsAttention` is the single place that flags exhaustion and notifies the sender; its once-only behaviour comes from the status guard, not from a flag column (CB-005).
- One bad receiver must not end a tick: an invalid `timezone` / `scheduleTimeWindow` is skipped, counted in `dueCheckIns.failed` and audited as `check_in.schedule_invalid`; a throwing provider marks that attempt `FAILED` and leaves the receiver's remaining attempts scheduled (CB-004).
- `check_in.schedule_invalid` is written, and the sender's quiet push sent, only when `markScheduleInvalid` flips `receivers.scheduleInvalidAt` from null (an `updateMany` guarded on `scheduleInvalidAt: null`, the same idiom as the status guards); the tick that sees the schedule evaluate again clears the stamp through `clearScheduleInvalid` so the next bad version is audited and pushed afresh (CB-069). Do not audit or push from the skipped list without the stamp. The push is `NotificationsService.sendQuietUpdateToUser` (never the siren), its outcome is audited on the receiver as `sender_push.sent` / `not_delivered` / `failed` with `reason: "schedule_invalid"` and `deepLink`, and a push failure never ends the tick.
- A delivery failure (`recordMessagingProviderStatus`) fails the attempt through `markSentAttemptProviderFailure`, so a status that arrives after a reply, a timeout or another callback closed the attempt is a no-op; it never sends from the webhook — it only makes the next pending attempt due (`expediteNextPendingAttempt`, the earliest PENDING attempt only, never the whole tail) and lets the next tick send it. A closed check-in gets the attempt marked and audited and nothing else (CB-006).
- `senderDisplayName` is resolved at send time through `UsersService.senderDisplayNameFor` from the receiver's owner (`CheckInReceiverCandidate.userId`, `CheckInAttemptWithCheckInRecord.checkIn.receiverUserId`) and never enters audit metadata; a missing `UsersService` or an unnamed sender yields "your family member", never an empty string.
- Attempt 2 onwards renders `checkin_retry`; attempt 1 — including attempt 1 of a try-later check-in, which reaches the cascade unsent — renders `checkin_daily`, and voice always plays `checkin_daily_voice`. Both templates take the same variables (`checkInMessageVariables`).
- `findDuePendingAttempts` selects `scheduledAt <= now`. Do not widen the horizon to "find the next attempt" — that sends staggered retries immediately. `hasPendingAttempts` is the only place allowed to use the far-future timestamp, and only to ask whether any attempt remains.
- `isClosed` terminal set is `RESPONDED_OK, RESPONDED_HELP, ESCALATED, RESOLVED, FAILED, SKIPPED`. `NEEDS_ATTENTION` is deliberately not terminal: a late reply still closes it.
- Daily dedupe is `(receiverId, scheduledLocalDate)` over rows with `retryOf IS NULL`: the repository's batched lookup in `findReceiversDueForCheckIn` decides, and the partial unique index `check_ins_receiverId_scheduledLocalDate_key` is the last line of defence against an overlapping tick (`createPending` throws `CheckInAlreadyScheduledError`, the service counts `skipped`). Together they are the only thing stopping the 10-minute cron from re-sending all day. Any row created outside the cron (try-later) must set `retryOf`, or it collides with the day's real check-in; never widen the dedupe to the UTC day again.
- The run route returns counts only. Do not add ids or provider detail to its response.
- Voice caller-ID selection requires `status: ACTIVE` **and** `complianceStatus: 'APPROVED'` for both sticky reuse and new pool assignment; a caller ID that is merely active must never dial out.
- Phone numbers are decrypted only at the channel-send boundary; audit metadata stays ids, statuses, counts, channels and operational reasons.

## Known gaps

- Try-later rows do not yet carry `retryOf`: `receivers.service.ts` (`tryCheckInLaterForSender`, owned by the receivers slice of sprint 2) still calls `createPending({ receiverId, scheduledAt: retryAt })`. Until it passes `retryOf: context.checkInId` and `scheduledLocalDate: localDateInTimeZone(retryAt, context.receiver.timezone)`, a try-later on a day that already has a check-in hits the unique index and surfaces as `CheckInAlreadyScheduledError` (500) on a real database.
- CB-017 — try-later retries in 15 min (BRD says 2 h) and is allowed while a cascade is still `SENT`, so cascades can overlap.
- CB-045 — no lock or claim on the cron: overlapping ticks can double-send; `hasPendingAttempts` loads every pending attempt per failure.
- CB-053 — the scheduler workflow exits 0 when its secrets are absent (green forever), the GitHub cron auto-disables, and there is no dead-man alert.
- CB-057 — only `daily` scheduling is honoured (`scheduleCustomCron` is stored and ignored), cascade offsets are hard-coded, and voice has no quiet hours.
- CB-060 — no auto-pause after five consecutive failed days.
- CB-069 — the backend audits once and pushes the sender once per schedule version; the receiver card in the app does not show the invalid state yet (mobile slice).
- A delivery failure pulls only the next attempt forward; the attempts after it keep their absolute offsets from the check-in's `scheduledAt`, so a cascade that fails early still has its later stagger (CB-057 owns the offsets).

The hosted scheduler `.github/workflows/operations-check-ins.yml` (cron `*/10 * * * *`, `workflow_dispatch`, concurrency group `operations-check-ins`) is currently **disabled by GitHub for inactivity**; see `docs/SECURITY.md` section 7. It skips with a notice when `OPERATIONS_CHECK_INS_RUN_URL` / `OPERATIONS_CRON_SECRET` are unset, and never receives the Supabase service-role key.

Related handoffs: `docs/handoffs/escalations-and-notifications.md` (sender siren, backup-contact alerts, `escalateSenderRequestedBackup`) and `docs/handoffs/channels-and-providers.md` (SMS/WhatsApp/voice providers, message catalog, provider webhooks).

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` §0a (793–804), §1–§3 (806–884), §12–§17 (1543–1765), §19–§20 (1794–1847), §29c (2343–2363), §34 (3366–3400).
- Acceptance evidence: `docs/audits/2026-09-06/sprint1-acceptance.md` S2 (tick with a bad row), S6 (STOP cancels the cascade), S8 (exhaustion → `NEEDS_ATTENTION`, one notification, guarded re-run).
- PRs: #20 (CB-004/005/006/008 — resilient tick, exhaustion notification, guarded transitions, cancellation), #21 (sprint 1 close: acceptance report and backlog follow-ups), #28 (CB-013 local-day dedupe, CB-069 once-per-version audit, CB-010 `checkin_retry`), #31 (CB-016 delivery-status failure advances the cascade, CB-069 sender quiet push, CB-010 sender display name in check-in copy).
