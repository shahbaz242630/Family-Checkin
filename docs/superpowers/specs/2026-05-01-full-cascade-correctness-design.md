# Full Cascade Correctness Design

## Goal

Complete the BRD Phase 1 smart cascade behavior with a dedicated cascade-attempt timeline, while preserving the existing receiver reply, backup escalation, and sender action flows.

## BRD Scope Covered

- `FR-CSC-01`: cascade triggers at scheduled time.
- `FR-CSC-02`: successful OK response closes silently.
- `FR-CSC-03`: WhatsApp/SMS/voice fallback timing.
- `FR-CSC-04`: sender gets choice after full cascade failure.
- `FR-CSC-05`: backup alert remains sender-initiated.
- `FR-CSC-06`: sender or backup contact can resolve.
- `FR-CSC-07`: maximum one scheduled cascade per receiver per day.
- `FR-REC-03`: WhatsApp, SMS, and voice-only tech profiles.
- `FR-CHN-01` through `FR-CHN-03`: WhatsApp, SMS, and short voice confirmation calls.

## Data Model

Add a dedicated `check_in_attempts` table/model. This table records receiver-channel cascade attempts only. It does not replace `escalation_events`, which remains the timeline for backup-contact and human escalation actions.

Fields:

- `id`: UUID primary key.
- `checkInId`: UUID foreign key to `check_ins`.
- `attemptNumber`: ordered integer starting at 1.
- `channel`: `WHATSAPP`, `SMS`, or `VOICE`.
- `status`: new enum `CheckInAttemptStatus` with `PENDING`, `SENT`, `RESPONDED`, `FAILED`, `TIMED_OUT`, `SKIPPED`.
- `scheduledAt`: when the attempt is eligible to send.
- `sentAt`: when provider accepted/sent the attempt.
- `completedAt`: when the attempt reached a terminal attempt state.
- `providerMessageId`: Twilio/fake message id or call id.
- `providerStatus`: provider accepted/queued/sent/ringing status.
- `failureReason`: safe operational reason such as `provider_send_failed`, `superseded_by_response`, or `cascade_closed`.
- `createdAt`, `updatedAt`.

Add `CheckInStatus.NEEDS_ATTENTION`.

Reason: `SKIPPED` currently means a terminal backup/escalation outcome, such as no backup contacts. It should not also mean "receiver cascade exhausted." `NEEDS_ATTENTION` is a clearer sender-actionable state after all receiver channels failed to produce a response.

## Cascade Plans

The backend builds the cascade plan from receiver profile and stored fallback channels.

Default timing:

- WhatsApp profile:
  - attempt 1: `WHATSAPP` at scheduled check-in time
  - attempt 2: `SMS` 15 minutes later
  - attempt 3: `VOICE` 45 minutes after initial scheduled time
  - sender attention after 75 minutes total
- SMS profile:
  - attempt 1: `SMS` at scheduled check-in time
  - attempt 2: `VOICE` 30 minutes later
  - sender attention after 60 minutes total
- Voice-only profile:
  - attempt 1: `VOICE` at scheduled check-in time
  - sender attention after 30 minutes total

The MVP stores these defaults in backend code near the cascade service, not in billing/tier config. Per-receiver configurable durations remain a later enhancement, but the attempt model must support future scheduled offsets.

## Operations Runner Behavior

`POST /operations/check-ins/run` continues to be the scheduler entrypoint.

The runner will:

1. Create due daily check-ins as it does today, but also create the first cascade attempt.
2. Process due cascade attempts whose `scheduledAt <= now` and `status = PENDING`.
3. Send each due attempt through `ChannelRouterService`.
4. Mark send success as `SENT` with provider ids/status.
5. Mark send failure as `FAILED` and immediately create or activate the next fallback attempt when one exists.
6. Mark sent attempts as `TIMED_OUT` when their response window expires and no receiver response exists.
7. After the final receiver-channel attempt times out or fails, mark the check-in `NEEDS_ATTENTION`.
8. Never alert backup contacts automatically after cascade exhaustion.

If the check-in is already `RESPONDED_OK`, `RESPONDED_HELP`, `ESCALATED`, `RESOLVED`, `FAILED`, or `SKIPPED`, pending remaining receiver attempts are marked `SKIPPED` with `failureReason = cascade_closed`.

## Reply Handling

`ReceiverReplyService.handleInboundReply` remains the single normalized inbound reply path for fake, Twilio SMS, Twilio WhatsApp, and Twilio voice callbacks.

When a receiver responds OK or HELP:

- Mark the latest open check-in as `RESPONDED_OK` or `RESPONDED_HELP`.
- Mark the most recent sent attempt for that check-in as `RESPONDED`.
- Mark any pending future attempts as `SKIPPED` with `failureReason = superseded_by_response`.
- Keep existing HELP behavior: trigger backup escalation immediately.

This preserves silent success for OK replies.

## Sender Actions

Existing sender action endpoints remain, with state updates:

- `PATCH /receivers/:receiverId/check-ins/:checkInId/try-later`
  - Allowed for latest `SENT`, `NEEDS_ATTENTION`, `RESPONDED_HELP`, `FAILED`, and `SKIPPED`.
  - Creates a new cascade attempt sequence for the same check-in starting two hours later.
  - Does not create a second daily check-in.
  - Writes `check_in.try_later_requested` audit event.
- `PATCH /receivers/:receiverId/check-ins/:checkInId/alert-backup`
  - Allowed for latest `NEEDS_ATTENTION`, `RESPONDED_HELP`, `FAILED`, and `SKIPPED`.
  - Reuses `EscalationsService.escalateSenderRequestedBackup`.
- `PATCH /receivers/:receiverId/check-ins/:checkInId/resolve`
  - Allowed for latest `NEEDS_ATTENTION`, `RESPONDED_HELP`, `ESCALATED`, `FAILED`, and `SKIPPED`.
  - Existing resolution behavior remains.

## Operations/Admin Visibility

Operations summary/detail must separate receiver cascade attempts from backup escalation events.

Detail response should include:

- `attempts`: check-in attempt rows with ids, attempt number, channel, status, scheduled/sent/completed timestamps, and safe failure reason.
- `escalations`: existing backup escalation events.

Summary should count `NEEDS_ATTENTION` as an operational status.

Admin/mobile views must not expose receiver names, phone numbers, message bodies, transcripts, encrypted payloads, provider error bodies, or raw provider payloads.

## Mobile Sender Visibility

Mobile status mapping should add:

- `NEEDS_ATTENTION` -> `Needs attention`

Receiver detail should show existing sender actions for `NEEDS_ATTENTION`:

- `Try again later`
- `Alert backup contacts`
- `Mark resolved`

No push notification delivery is included in this slice. The state enables notification delivery in the next slice.

## Audit Safety

New audit events must keep metadata PII-safe:

- `check_in.attempt_created`
- `check_in.attempt_sent`
- `check_in.attempt_failed`
- `check_in.attempt_timed_out`
- `check_in.needs_attention`
- `check_in.attempt_skipped`

Allowed metadata: receiver id, check-in id, attempt id, attempt number, channel, status, provider status, safe failure reason.

Forbidden metadata: names, phone numbers, message bodies, transcripts, addresses, location instructions, raw provider payloads, provider error bodies.

## Migration Strategy

Add Prisma enum/model and migration:

- `CheckInAttemptStatus`
- `CheckInAttempt`
- relation from `CheckIn` to `attempts`
- indexes on:
  - `checkInId`
  - `status, scheduledAt`
  - `checkInId, attemptNumber`

No backfill is required for historical check-ins. Existing historical rows simply have no cascade attempts.

## Verification

Backend tests must cover:

- plan creation for WhatsApp, SMS, and voice-only profiles.
- initial due check-in creates first attempt.
- due attempt send success.
- provider failure advances to next fallback.
- response window timeout advances to next fallback.
- final timeout marks check-in `NEEDS_ATTENTION`.
- OK reply closes attempt/future attempts silently.
- HELP reply closes attempts and preserves existing escalation behavior.
- `try later` creates a delayed retry sequence on the same check-in.
- operations detail separates attempts from escalations.
- audit metadata remains PII-safe.

Mobile tests must cover:

- `NEEDS_ATTENTION` status label/tone.
- admin operations formatting for attempt statuses if helper coverage is needed.

Full verification:

- backend focused tests
- backend full test suite
- backend type-check
- backend build
- Prisma validation
- mobile status helper tests
- mobile type-check

## Out Of Scope

- Billing/tier gating.
- Push notification delivery.
- Localization/template rewrite.
- Payment failure handling.
- Human-agent escalation.
- Voice conversational AI.
- Real production smoke with live Twilio credentials.
