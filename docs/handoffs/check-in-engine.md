# Scheduled check-in engine — feature handoff

Status: Built · Last verified: 2026-09-06 (acceptance run — S2/S6/S8; sender actions and voice caller-ID: specs)
BRD: BRD-4.3, BRD-6.2, FR-CSC-01, FR-CSC-03, FR-CSC-04, FR-CSC-07, FR-REC-06 · Open backlog: CB-013, CB-017, CB-045, CB-053, CB-057, CB-060, CB-069

## What it does

- Creates one `PENDING` check-in per granted, non-paused, non-deleted, entitled receiver whose `scheduleTimeWindow` is open in the receiver's own IANA timezone, at most once per UTC day.
- Writes the whole channel cascade up front as `check_in_attempts` rows with staggered `scheduledAt`, sends attempt 1 immediately, and marks the check-in `SENT`.
- On each later tick, times out attempts whose response window has elapsed and sends the next attempt that is already due; a future attempt keeps the check-in open instead of ending it.
- When no attempt is left the check-in becomes `NEEDS_ATTENTION` and the sender is notified once (siren push, voice fallback) — see `docs/handoffs/escalations-and-notifications.md`.
- Cancels every open check-in and every pending attempt of a receiver on STOP, REPORT, pause or delete.
- Gives the sender three actions on an actionable check-in: retry later, alert backup contacts, mark resolved.
- Picks a sticky per-receiver voice caller ID from a country-matched pool for `VOICE` attempts.

## Where it lives

| Layer   | Paths                                                                                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend | `apps/backend/src/modules/check-ins/` (service, repository, voice caller-ID repository, module); `apps/backend/src/modules/operations/operations.controller.ts`; `apps/backend/src/shared/schedule/receiver-schedule.ts`; sender actions in `apps/backend/src/modules/receivers/receivers.service.ts` + `receivers.controller.ts` |
| Mobile  | `apps/mobile/src/app/(main)/receivers/[id].tsx`; `apps/mobile/src/services/backendApi.ts`                                                                                                                   |
| Ops     | `.github/workflows/operations-check-ins.yml`; `apps/backend/scripts/run-operations-check-ins.ts`; `apps/backend/src/modules/operations/operations-runner.ts`; npm script `operations:check-ins`             |
| Data    | `check_ins`, `check_in_attempts`, `voice_caller_id_pool`, `receiver_voice_caller_id_assignments`; migrations `202604260001_initial_nearby_schema`, `202605010001_check_in_attempts`, `202605100001_twilio_voice_readiness` |
| Tests   | `check-ins.service.spec.ts`, `prisma-check-ins.repository.spec.ts`, `prisma-voice-caller-id.repository.spec.ts`, `operations.controller.spec.ts`, `operations-runner.spec.ts`, `receiver-schedule.spec.ts`, `receivers.service.spec.ts`, `receivers.controller.spec.ts` |

## Routes and contracts

- `POST /operations/check-ins/run` — scheduler only. `Authorization: Bearer <OPERATIONS_CRON_SECRET>`, compared timing-safely by `assertBearerSecret` (`apps/backend/src/shared/auth/bearer-secret.ts`); missing or wrong bearer is `401 "Operations cron bearer token is required"`. Carries `@SkipThrottle()` because the scheduler calls it in bursts. Runs `sendDueCheckIns()` then `processCascadeAttempts()` and returns aggregate counts only: `{ ok: true, dueCheckIns: { created, sent, skipped, failed }, cascadeAttempts: { sent, timedOut, failed, needsAttention, skipped } }` — no receiver ids, check-in ids, provider ids, names, phones or bodies.
- `PATCH /receivers/:receiverId/check-ins/:checkInId/resolve` — sender Supabase bearer. Only when the receiver's latest check-in is that id and its status is `RESPONDED_HELP`, `ESCALATED`, `NEEDS_ATTENTION`, `FAILED` or `SKIPPED`; sets `RESOLVED`, `resolvedAt`, `resolutionByUserId`, audits `check_in.resolved` (metadata: `receiverId`), returns `{ receiver }`; otherwise `404`.
- `PATCH /receivers/:receiverId/check-ins/:checkInId/alert-backup` — sender Supabase bearer. Actionable from `RESPONDED_HELP`, `NEEDS_ATTENTION`, `FAILED`, `SKIPPED`; audits `check_in.backup_alert_requested` then delegates to `EscalationsService.escalateSenderRequestedBackup`.
- `PATCH /receivers/:receiverId/check-ins/:checkInId/try-later` — sender Supabase bearer. Actionable from `SENT`, `RESPONDED_HELP`, `NEEDS_ATTENTION`, `FAILED`, `SKIPPED`; creates a **new** `PENDING` check-in at `now + 15 min` with its own cascade and audits `check_in.try_later_requested` (`retryAt` in metadata). It does not change the status of the check-in it was invoked on.
- `GET /operations/check-ins/summary` and `GET /operations/check-ins/:checkInId` share the controller but belong to the admin operations-visibility surface, not this feature.

### Constants in the code

`apps/backend/src/modules/check-ins/check-ins.service.ts`, `buildCascadeAttempts`:

- `TechProfile.VOICE_ONLY` / `TechProfile.LANDLINE` → three `VOICE` attempts at `[0, 15, 45]` minutes after `scheduledAt`.
- Otherwise the channel list is `[primaryChannel, ...fallbackChannels]` deduped, and the offset for index `i` is `0` when `i === 0`, else `previous === Channel.WHATSAPP ? 15 : index === 1 ? 30 : 45` minutes.

`isAttemptTimedOut` in the same file holds the response window: `const windowMinutes = attempt.channel === Channel.WHATSAPP ? 15 : 30;` — an attempt is timed out once `sentAt + windowMinutes <= now`. Both the offsets and the window are inline literals, not named constants (CB-057).

The sender retry offset is `15 * 60 * 1000` in `receivers.service.ts` (`tryCheckInLaterForSender`); the BRD figure is 2 hours (CB-017).

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
| attempt `markLatestSentAttemptResponded` → `RESPONDED` | `SENT` |
| attempt `skipPendingAttemptsForCheckIn` → `SKIPPED` | `PENDING` |

There is no `CANCELLED` status: cancellation writes `SKIPPED` with the reason on the attempts (`receiver_opted_out`, `abuse_reported`, `receiver_paused`, `receiver_deleted`).

## How to exercise it locally (fake mode)

- Follow `docs/EMULATOR_RUNBOOK.md` sections 1–5 (fake providers, backend on port 3000).
- Tick: `Invoke-RestMethod -Method Post -Uri http://localhost:3000/operations/check-ins/run -Headers @{ Authorization = 'Bearer <OPERATIONS_CRON_SECRET>' }`.
- Reply as the receiver through `POST /receiver-replies/fake` (fake mode only, same cron-secret bearer).
- To watch the cascade exhaust without waiting, age `check_in_attempts.sentAt` past the response window in the database and run the tick again; repeat until `cascadeAttempts.needsAttention` is 1.
- The per-UTC-day dedupe means a second tick creates nothing for the same receiver; move the existing `check_ins.scheduledAt` back a day to test the next creation.
- Focused specs: `npm.cmd --prefix apps/backend test -- src/modules/check-ins/ src/modules/operations/ src/shared/schedule/`.

## Invariants — do not break

- Every status write goes through the `allowedFrom` guards and callers treat `false` as "someone else closed this first": no audit, no notification, no reopen (CB-006). Never replace them with a read-then-write.
- `markCheckInNeedsAttention` is the single place that flags exhaustion and notifies the sender; its once-only behaviour comes from the status guard, not from a flag column (CB-005).
- One bad receiver must not end a tick: an invalid `timezone` / `scheduleTimeWindow` is skipped, audited as `check_in.schedule_invalid` and counted in `dueCheckIns.failed`; a throwing provider marks that attempt `FAILED` and leaves the receiver's remaining attempts scheduled (CB-004).
- `findDuePendingAttempts` selects `scheduledAt <= now`. Do not widen the horizon to "find the next attempt" — that sends staggered retries immediately. `hasPendingAttempts` is the only place allowed to use the far-future timestamp, and only to ask whether any attempt remains.
- `isClosed` terminal set is `RESPONDED_OK, RESPONDED_HELP, ESCALATED, RESOLVED, FAILED, SKIPPED`. `NEEDS_ATTENTION` is deliberately not terminal: a late reply still closes it.
- Daily dedupe is the `NOT: { checkIns: { some: { scheduledAt within the UTC day } } }` clause in `findReceiversDueForCheckIn`; it is the only thing stopping the 10-minute cron from re-sending all day.
- The run route returns counts only. Do not add ids or provider detail to its response.
- Voice caller-ID selection requires `status: ACTIVE` **and** `complianceStatus: 'APPROVED'` for both sticky reuse and new pool assignment; a caller ID that is merely active must never dial out.
- Phone numbers are decrypted only at the channel-send boundary; audit metadata stays ids, statuses, counts, channels and operational reasons.

## Known gaps

- CB-013 — daily dedupe uses the UTC day, so windows spanning UTC midnight can double-send and a try-later row can suppress the next day.
- CB-017 — try-later retries in 15 min (BRD says 2 h) and is allowed while a cascade is still `SENT`, so cascades can overlap.
- CB-045 — no lock or claim on the cron: overlapping ticks can double-send; `hasPendingAttempts` loads every pending attempt per failure.
- CB-053 — the scheduler workflow exits 0 when its secrets are absent (green forever), the GitHub cron auto-disables, and there is no dead-man alert.
- CB-057 — only `daily` scheduling is honoured (`scheduleCustomCron` is stored and ignored), cascade offsets are hard-coded, and voice has no quiet hours.
- CB-060 — no auto-pause after five consecutive failed days.
- CB-069 — `check_in.schedule_invalid` is audited on every tick for a bad row (~144 rows a day) and the sender is never told.

The hosted scheduler `.github/workflows/operations-check-ins.yml` (cron `*/10 * * * *`, `workflow_dispatch`, concurrency group `operations-check-ins`) is currently **disabled by GitHub for inactivity**; see `docs/SECURITY.md` section 7. It skips with a notice when `OPERATIONS_CHECK_INS_RUN_URL` / `OPERATIONS_CRON_SECRET` are unset, and never receives the Supabase service-role key.

Related handoffs: `docs/handoffs/escalations-and-notifications.md` (sender siren, backup-contact alerts, `escalateSenderRequestedBackup`) and `docs/handoffs/channels-and-providers.md` (SMS/WhatsApp/voice providers, message catalog, provider webhooks).

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` §0a (793–804), §1–§3 (806–884), §12–§17 (1543–1765), §19–§20 (1794–1847), §29c (2343–2363), §34 (3366–3400).
- Acceptance evidence: `docs/audits/2026-09-06/sprint1-acceptance.md` S2 (tick with a bad row), S6 (STOP cancels the cascade), S8 (exhaustion → `NEEDS_ATTENTION`, one notification, guarded re-run).
- PRs: #20 (CB-004/005/006/008 — resilient tick, exhaustion notification, guarded transitions, cancellation), #21 (sprint 1 close: acceptance report and backlog follow-ups).
