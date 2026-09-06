# Backup contacts — feature handoff

Status: Built · Last verified: 2026-09-06 (emulator acceptance: backup contact added through the detail screen, HELP → alert with name and location instructions → DONE resolved; `docs/audits/2026-09-06/emulator-acceptance.md`)
BRD: FR-BAK-03, FR-CSC-05, FR-CSC-06, BRD-4.4 · Open backlog: none

## What it does

- A sender adds up to 5 active backup contacts per receiver, each with a name, phone, relationship, and optional location instructions. Backup contacts never install the app.
- The list shows a display name, a masked phone (`*******1234`), the relationship, and whether location instructions are saved. Raw phone, phone hash, and encrypted values never leave the backend.
- Edit and remove work from the same list. Remove is a soft delete, so the contact stops receiving alerts but the row survives for audit.
- When a check-in escalates, every active backup contact is messaged once, in priority order — WhatsApp when the channel router confirms the number is reachable there, otherwise SMS (CB-011) — in the receiver's language, with the receiver's name, the channels already tried, and the contact's own location instructions. The escalation triggers themselves live in `docs/handoffs/escalations-and-notifications.md`.
- A backup contact replying `DONE`, `CHECKED`, or `RESOLVED` from their own number closes the receiver's latest actionable check-in as `RESOLVED`. This is the BRD closure loop. The contact's wording is kept encrypted on the check-in (`check_ins.resolutionNote`, as a `Backup contact reply: …` line appended under any sender note) and the sender gets a quiet push (`reason: backup_contact_done`, deep link to the receiver).

## Where it lives

| Layer   | Paths                                                                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend | `apps/backend/src/modules/backup-contacts/` (controller, service, repository, Prisma repository)                                                                                                        |
| Backend | `apps/backend/src/modules/escalations/escalations.service.ts` (`escalateBackupContacts`, `backupAlertContext`, `alertBackupContactChannel`)                                                              |
| Backend | `apps/backend/src/modules/receivers/receiver-reply.service.ts` (`handleBackupContactReply`, `normalizeBackupContactReply`)                                                                               |
| Backend | `apps/backend/src/modules/channels/message-catalog.templates.ts` (`backup_contact_help_alert`, `backup_contact_missed_checkin_alert`, `backup_contact_sender_requested_alert`) via `MessageCatalogService` |
| Mobile  | `apps/mobile/src/app/(main)/receivers/[id].tsx` (Backup Contacts section, inline add/edit form); API calls in `apps/mobile/src/services/backendApi.ts`                                                    |
| Data    | `backup_contacts` (Prisma model `BackupContact`), created in `202604260001_initial_nearby_schema`; no later migration touches it                                                                          |
| Tests   | `backup-contacts.service.spec.ts`, `backup-contacts.controller.spec.ts`, `prisma-backup-contacts.repository.spec.ts`, `escalations.service.spec.ts`, `receiver-reply.service.spec.ts`, `app.module.spec.ts` |

There are no dedicated backup-contact components under `apps/mobile/src/components/`; the UI is inline in the receiver detail screen and reuses `ReceiverPhoneInput` and `TextInput`.

## Routes and contracts

- `GET /receivers/:receiverId/backup-contacts` — sender, Supabase bearer. Returns `{ backupContacts: [...] }` ordered by `priorityOrder` then `createdAt`. `404` when the receiver is missing, soft-deleted, or not owned.
- `POST /receivers/:receiverId/backup-contacts` — sender, Supabase bearer. Body `{ name, phone, phoneCountry?, relationshipToReceiver, locationInstructions? }`. Assigns `priorityOrder` from the active count and returns `{ backupContact }`.
- `PATCH /receivers/:receiverId/backup-contacts/:backupContactId` — sender, Supabase bearer. Same body; `phone` is optional and the stored number is kept when it is omitted. A blank `locationInstructions` clears the stored value. `404` when the contact is missing, deleted, or not owned.
- `DELETE /receivers/:receiverId/backup-contacts/:backupContactId` — sender, Supabase bearer. Soft delete; returns the removed `{ backupContact }` summary.

Every route verifies the bearer token through `SupabaseAuthService`, syncs the sender through `UsersService.upsertFromSupabaseIdentity`, and scopes each query by `userId + receiverId + deletedAt: null`.

Not owned by this feature but part of the loop: `PATCH /receivers/:receiverId/check-ins/:checkInId/alert-backup` (sender-requested alert, receivers module) and `POST /receiver-replies/fake` (fake mode only, cron-secret bearer, `ReceiverRepliesModule`).

## How to exercise it locally (fake mode)

Set up per `docs/EMULATOR_RUNBOOK.md`, then:

1. In the app, open a receiver and add a backup contact (name, phone, relationship, location instructions). Confirm the list shows the masked phone and `Instructions saved`.
2. Run the tick so the receiver has an open check-in:
   `Invoke-RestMethod -Method Post -Uri http://localhost:3000/operations/check-ins/run -Headers $h`
3. Fake a `HELP` reply from the **receiver's** number:
   `Invoke-RestMethod -Method Post -Uri http://localhost:3000/receiver-replies/fake -Headers $h -Body '{"fromPhone":"+971500000001","channel":"SMS","body":"HELP"}'`
   Expect `check_in_responded_help` / `RESPONDED_HELP` on the response, the check-in row moving to `ESCALATED`, and one `escalation_event` per backup contact (`WHATSAPP` in fake mode, where both fake providers claim every number) with `backupAlertedAt` set.
4. Fake `DONE` from the **backup contact's** number with the same command shape. Expect `201 {"action":"check_in_resolved_by_backup","checkInStatus":"RESOLVED"}`, `resolvedAt` set, `GET /receivers/<id>` showing `latestCheckIn.resolutionNote: "Backup contact reply: DONE"`, and `sender_push.not_delivered {reason:"backup_contact_done"}` audited (no device token registered).

`$h` is the cron-secret header block from the runbook. The alert copy prints in the backend terminal as a `[fake-provider]` line and is returned by `GET /receiver-replies/fake/outbound` (CB-067). The 2026-09-06 acceptance run recorded the rendered English body as:

> Hi Ahmed, this is Nearby. Margaret asked for help during a check-in from their family member. We reached them by SMS. Please contact them now. Where to find them: Flat 2, key under the mat Reply DONE once you have reached them.

## Invariants — do not break

- Ownership is enforced in the query, never after the fetch: every read and write filters on the sender's `userId`, a non-deleted receiver, and `deletedAt: null`. A `null` return from the repository means "not found for this sender" and the controller must turn it into `404`, not an empty list.
- The ≤5 cap is checked with `countActiveForReceiverForUser` before the insert, and `priorityOrder` is that count. Both the cap and the ordering depend on soft-deleted rows being excluded.
- Delete is `deletedAt`, never a row removal. `findActiveByPhoneHash` and the escalation lookup both rely on `deletedAt: null` to stop alerting removed contacts.
- Name, phone, and location instructions are encrypted at rest (AES-256-GCM); `phoneHash` is the deterministic lookup key that matches an inbound reply to a backup contact. Changing the phone must rewrite the encrypted value and the hash together.
- The list response is a summary only. Never add raw phone, `phoneHash`, or decrypted location instructions to `BackupContactSummary` — the mobile edit form is built on the assumption that phone comes back masked and is preserved when left blank.
- Audit metadata for backup contacts carries ids and safe scalars only (`receiverId`, `backupContactId`, `priorityOrder`, `relationshipToReceiver`, channel, normalized reply, provider message id). No names, phones, or message bodies. The audit PII guard must keep allowing keys ending in `Id` (CB-002).
- Inbound replies resolve receivers first; only an unmatched number falls through to `handleBackupContactReply`. A backup contact's `DONE` therefore never shadows a receiver reply.
- The close is a guarded transition: `markResolvedByBackupContact` uses `updateMany` with `status in CHECK_IN_ALLOWED_FROM.resolvedByBackupContact` (`RESPONDED_HELP`, `ESCALATED`, `NEEDS_ATTENTION`, `FAILED`, `SKIPPED`). A late `DONE` on an already-closed check-in audits `backup_contact.reply_ignored` and returns `no_actionable_check_in` — it must not 500 or reopen the check-in.
- The note write happens only after the guarded close succeeded, through the receivers repository (`setCheckInResolutionNote`), so a rejected close never leaves a stray note. The reply text is encrypted; `check_in.resolved_by_backup` carries `resolutionTextStored: true`, never the text (the audit PII guard rejects keys containing `note`). The sender push is best effort and audited as `sender_push.*` on the check-in.
- An unrecognised body from a known backup contact audits `backup_contact.reply_unrecognised` and returns `unrecognised_reply`; unknown senders audit `inbound_reply.unknown_sender`. Inbound replies never 500 (CB-015).
- `BackupContactsService` throws a plain `Error` for the cap and for missing fields, so those surface as `500`. The mobile Add button hides at 5 contacts, which is what keeps the cap out of the user's way today.

## Known gaps

- Only the exact keywords close a check-in, so the stored reply text is one of `DONE` / `CHECKED` / `RESOLVED` in the contact's own casing; free text such as "Done, I am with her" is `unrecognised_reply` and is not stored.
- The sender's own name is not stored, so backup alerts say "their family member" (`NEUTRAL_SENDER_DISPLAY_NAME_FOR_BACKUP_CONTACTS`); a sender display name column is a remaining CB-010 slice.
- Only English catalog copy exists for the three backup templates; other languages fall back to English and flag `renderFallback` in audit metadata.
- Backup contacts have no app, no invite, and no login. There is no way for them to see history or opt out beyond replying.
- Mobile backup-contact remove was never smoked end to end (archive §9 stopped short of the destructive step); the 2026-05-18 Android QA covered login, dashboard, drawer, add-receiver, admin, and billing, not the backup-contact UI.

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` §7 CRUD foundation (lines 1258–1334), §8 update/delete (1335–1400), §9 partial smoke (1401–1467), §28 DONE reply handling (2195–2233), §0a sprint 1 (793–804).
- Acceptance: `docs/audits/2026-09-06/sprint1-acceptance.md` scenario S5 (HELP → backup alert → DONE, PASS).
- PRs: #18 (CB-002 audit PII guard, which is what made HELP → backup work at all in production wiring; CB-003 real DI-graph boot spec), #19 (CB-010 English slice — backup bodies now render from `MessageCatalogService`), #20 (CB-006 guarded status writes, CB-008 cancellation).
