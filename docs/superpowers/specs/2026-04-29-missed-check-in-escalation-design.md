# Missed Check-In Escalation Design

## Goal

Escalate check-ins that were sent to a receiver but did not receive a response within the approved 30-minute response window.

## Scope

This slice adds backend business logic only. It does not add a cron runner, mobile UI, configurable per-receiver response windows, sender notifications, or real provider-specific copy.

## Architecture

Extend `CheckInsService` with `escalateOverdueCheckIns`, which finds open `SENT` check-ins whose `sentAt` is older than the response window and delegates backup-contact alerting to `EscalationsService`.

Extend `EscalationsService` with `escalateMissedCheckIn`, reusing the same ordered backup-contact alert behavior as HELP escalation but using a distinct template, audit reason, and source metadata.

## Data Flow

1. A job runner or manual backend caller invokes `CheckInsService.escalateOverdueCheckIns()`.
2. The service calculates `overdueBefore = now - 30 minutes`.
3. The repository returns check-ins with `status = SENT` and `sentAt <= overdueBefore`.
4. For each overdue check-in, `EscalationsService.escalateMissedCheckIn` alerts active backup contacts.
5. If at least one alert succeeds, the check-in is marked `ESCALATED`.
6. If no active backup contacts exist, the check-in remains `SENT` and a PII-safe audit entry records the missing escalation path.

## Error Handling

Provider failures are recorded per backup contact as `EscalationResult.ERROR`, and the service continues to the next contact. A missed check-in is marked `ESCALATED` only if at least one backup-contact alert succeeds.

The overdue query must exclude already escalated, responded, resolved, failed, or skipped check-ins by selecting only `SENT`.

## Testing

Implementation must be test-first:

- Unit test: overdue `SENT` check-in older than 30 minutes is delegated to missed-check-in escalation.
- Unit test: recent `SENT` check-in inside 30 minutes is not returned by the Prisma overdue query.
- Unit test: missed-check-in escalation uses template `backup_contact_missed_checkin_alert` and PII-safe audit metadata.
- Full backend tests, type-check, build, and Prisma validation must pass before commit.
