# Check-In Resolution Plan

## Scope

Add sender-driven check-in resolution for actionable latest check-ins.

## Steps

1. Add receiver service tests for resolving an actionable latest check-in and rejecting missing/non-actionable check-ins.
2. Add receiver controller test for `PATCH /receivers/:receiverId/check-ins/:checkInId/resolve`.
3. Add Prisma receiver repository test for ownership-scoped check-in update.
4. Implement repository, service, and controller paths.
5. Add mobile backend API method.
6. Add `RESOLVED` status display and receiver detail `Mark resolved` action.
7. Update handoff and run focused plus full verification.

## Out Of Scope

- Free-text resolution notes.
- Backup-contact `DONE` reply ingestion.
- Push notifications.
- Incident history timeline.
