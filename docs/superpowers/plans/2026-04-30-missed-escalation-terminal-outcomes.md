# Missed Escalation Terminal Outcomes Plan

## Scope

Make missed-check-in escalation terminal when it cannot alert any backup contact, so scheduled operations do not repeatedly process the same overdue check-in.

## Steps

1. Add service tests for missed-check-in no-contact and all-provider-failed terminal outcomes.
2. Add repository test and method for setting terminal check-in status.
3. Update missed-check-in escalation to mark `SKIPPED` for no backup contacts.
4. Update missed-check-in escalation to mark `FAILED` when every backup alert fails.
5. Keep explicit HELP-response escalation behavior unchanged.
6. Update overdue aggregation to count terminal `FAILED` outcomes as failed, not skipped.
7. Update handoff and run full backend verification.

## Out Of Scope

- Real provider integrations.
- Sender push notifications.
- Backup contact response handling.
- Smoke data deletion.
