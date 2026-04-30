# Check-In Resolution Design

## Goal

Let the sender close an incident after a check-in reaches an actionable state, so escalations and help responses do not remain visually open forever.

## Behavior

- Sender can resolve a check-in from receiver detail when the latest check-in status is:
  - `RESPONDED_HELP`
  - `ESCALATED`
  - `FAILED`
  - `SKIPPED`
- Resolving sets:
  - `status = RESOLVED`
  - `resolvedAt = now`
  - `resolutionByUserId = sender user id`
- The backend returns the updated receiver detail with latest check-in status `RESOLVED`.
- Mobile hides the action once the latest check-in is resolved.

## API

`PATCH /receivers/:receiverId/check-ins/:checkInId/resolve`

Authorization uses the existing sender Supabase bearer token. The update is scoped by receiver ownership and non-deleted receiver state.

## Security

- Sender can resolve only check-ins belonging to their own active receiver.
- The endpoint does not accept or persist free-text resolution notes yet, avoiding a new PII surface.
- Audit event `check_in.resolved` stores only receiver/check-in IDs and operational metadata.

## Testing

- Backend service/controller/repository tests cover ownership-scoped resolution and non-actionable missing check-ins.
- Mobile type-check covers the new API call and detail action wiring.
