# Operations Visibility Design

## Goal

Give operators a protected, read-only backend view of recent check-in health before real channel providers are wired.

## Endpoint

- `GET /operations/check-ins/summary`
- Auth: `Authorization: Bearer <OPERATIONS_CRON_SECRET>`
- Response must not include raw PII, encrypted payloads, message bodies, transcripts, or provider payload details.

## Response

- `ok: true`
- `windowHours`: numeric lookback window used for status counts
- `generatedAt`: server timestamp
- `statusCounts`: count of check-ins by status inside the lookback window
- `recent`: newest operational check-ins with:
  - `checkInId`
  - `receiverId`
  - `status`
  - `scheduledAt`
  - optional `sentAt`, `respondedAt`, `resolvedAt`
  - `escalationAttemptCount`
  - `successfulEscalationCount`

## Scope

- Count window defaults to 24 hours.
- Recent list defaults to 25 records.
- Include operationally important statuses in the recent list:
  - `RESPONDED_HELP`
  - `ESCALATED`
  - `FAILED`
  - `SKIPPED`
  - `RESOLVED`
- Exclude soft-deleted receivers from both counts and recent rows.

## Non-goals

- No admin UI yet.
- No search/filter query parameters yet.
- No raw PII or decrypted receiver/backup-contact data.
- No deletion or mutation.
