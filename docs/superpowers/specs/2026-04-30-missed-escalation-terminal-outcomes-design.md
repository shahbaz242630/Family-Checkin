# Missed Escalation Terminal Outcomes Design

## Goal

Prevent the operations scheduler from repeatedly processing the same overdue `SENT` check-in when missed-check-in escalation cannot successfully alert a backup contact.

## Problem

`CheckInsService.escalateOverdueCheckIns()` only asks for `SENT` check-ins. Successful backup alerts mark the check-in `ESCALATED`, so those rows stop being selected. But missed check-ins with no active backup contacts, or with provider failures for every contact, stayed `SENT`. A 10-minute scheduler would keep reprocessing the same row.

## Behavior

- Missed check-in with no active backup contacts:
  - audit `escalation.no_backup_contacts`
  - mark the check-in `SKIPPED`
  - audit `check_in.escalation_skipped`
- Missed check-in where every backup alert fails:
  - create failed escalation event rows as before
  - mark the check-in `FAILED`
  - audit `check_in.escalation_failed`
- Missed check-in with at least one successful backup alert:
  - existing behavior remains: mark `ESCALATED`
- Explicit receiver HELP responses keep existing behavior:
  - no backup contacts leaves the response as `RESPONDED_HELP`
  - all provider failures leave the response as `RESPONDED_HELP`

## Security

Audit metadata remains ID/status/count based only. No names, phone numbers, transcripts, message bodies, or provider payloads are written to audit metadata.

## Testing

Tests cover no-contact missed escalation, all-provider-failed missed escalation, Prisma terminal status updates, and operations aggregate counting for failed terminal outcomes.
