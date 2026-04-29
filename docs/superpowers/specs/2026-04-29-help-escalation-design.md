# Help Escalation Design

## Goal

Trigger a backend escalation when a receiver responds that they need help, using active backup contacts and the existing channel router.

## Scope

This slice covers `RESPONDED_HELP` only. Missed-check-in escalation, sender push/email notifications, mobile escalation UI, and real provider-specific copy are later slices.

## Architecture

Add an `EscalationsModule` with a focused service and repository. `ReceiverReplyService` remains responsible for interpreting inbound receiver replies and marking the open check-in responded. When that response is `help`, it calls `EscalationsService.escalateHelpResponse`.

The escalation service loads active backup contacts for the receiver ordered by `priorityOrder` and `createdAt`, sends an alert through `ChannelRouterService`, records an escalation event for each attempted contact, marks the check-in `ESCALATED` after at least one alert is accepted, and appends audit entries without names, phone numbers, or message bodies.

## Data Flow

1. Receiver replies `NO`, `HELP`, `NEED HELP`, or `2`.
2. `ReceiverReplyService` marks the latest open check-in as `RESPONDED_HELP`.
3. `ReceiverReplyService` calls `EscalationsService.escalateHelpResponse` with `receiverId`, `checkInId`, and the inbound channel.
4. `EscalationsService` loads active backup contacts for the receiver.
5. For each active backup contact, the service decrypts the phone number only for provider delivery and sends an SMS template named `backup_contact_help_alert`.
6. The repository creates an `EscalationEvent` with attempt number, channel, timestamps, and result.
7. After one or more accepted alerts, the repository marks the check-in `ESCALATED`.
8. Audit logs record event IDs, receiver ID, check-in ID, backup contact ID, channel, attempt number, and provider status only.

## Error Handling

If there are no active backup contacts, the service appends an audit entry and returns `attempted: 0` without changing the check-in to `ESCALATED`.

If a provider send fails for one backup contact, the service records an escalation event with `ERROR`, appends a PII-safe audit entry, and continues to the next backup contact. The check-in is marked `ESCALATED` only if at least one backup-contact alert succeeds.

## Testing

Implementation must be test-first:

- Unit test: HELP response triggers ordered backup-contact alert, creates a successful escalation event, marks the check-in `ESCALATED`, and writes PII-safe audit metadata.
- Unit test: no active backup contacts audits `escalation.no_backup_contacts` and does not mark the check-in escalated.
- Unit test: provider failure records `ERROR`, continues to the next contact, and marks escalated if a later contact succeeds.
- Existing receiver reply tests must still pass.
