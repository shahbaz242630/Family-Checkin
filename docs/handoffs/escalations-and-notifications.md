# Escalations and sender notifications — feature handoff

Status: Built · Last verified: 2026-09-06 (acceptance run)
BRD: FR-BAK-03, FR-CSC-04, FR-CSC-05, FR-CHN-03c-3/5/6/7/8, BRD-4.3 · Open backlog: CB-012, CB-023, CB-030, CB-031, CB-035, CB-038, CB-058, CB-074 (app part)
Per area: HELP escalation, cascade-exhaustion notification and voice fallback — 2026-09-06 (acceptance run); backup-alert channel selection and language, sender-requested backup alert without a sender siren, deep link in sender audit rows, device-token registration, push payload shape — 2026-09-06 (specs); mobile push registration — 2026-05-18 (emulator, Expo Go skips registration).

## What it does

- A receiver HELP reply marks the check-in `RESPONDED_HELP`, then alerts every active backup contact in `priorityOrder`, one message each: WhatsApp when `ChannelRouterService.resolveReachablePlan` confirms the number is reachable there (a configured provider that claims the number), otherwise SMS, and SMS again when the WhatsApp send fails (CB-011). The alert is rendered in the receiver's language (`receivers.language`, trimmed of its `char(5)` padding; English copy with `renderFallback: true` until other languages exist). One success marks the check-in `ESCALATED`.
- When a check-in's whole cascade goes unanswered, the check-in becomes `NEEDS_ATTENTION` and the sender gets a siren push with a deep link to the receiver. Backup contacts are deliberately not alerted here (FR-BAK-03).
- The sender can request the backup alert themselves from receiver detail (`Alert backup contacts`), which runs the same backup fan-out but never sirens the sender (founder decision 2026-09-06, CB-074): `sender_push.skipped {reason: "sender_initiated"}` is audited instead of a push or voice call, and `escalateSenderRequestedBackup` returns `{ outcome: 'alerted' | 'no_backup_contacts' | 'all_failed', alerted, failed }` for the receivers controller and the app to surface (not wired yet).
- Sender escalation pushes use a dedicated Expo shape: `sound: escalation-siren.wav`, `priority: high`, `channelId: emergency-alerts`, `interruptionLevel: timeSensitive`, `data.notificationType: escalation_siren`, `data.deepLink` (`/(main)/receivers/<receiverId>` on every siren — HELP, missed check-in and cascade exhaustion alike).
- When zero pushes are accepted (no active token, or the Expo call throws), the backend places a voice call to the sender with script `sender_escalation_siren_voice`.
- The mobile app registers an Expo push token after sign-in and creates the Android `emergency-alerts` channel first; the sender dashboard renders `ESCALATED`/`FAILED`/`SKIPPED` as `Backup alerted`/`Escalation failed`/`No backup available`.

## Where it lives

| Layer   | Paths                                                                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend | `apps/backend/src/modules/escalations/` (service, repository, module, tokens); `apps/backend/src/modules/notifications/` (controller, service, `expo-push.gateway.ts`, repository); callers: `check-ins.service.ts:551`, `receiver-reply.service.ts:410`, `receivers.service.ts:428`                            |
| Mobile  | `apps/mobile/src/services/pushNotifications.ts`; trigger in `apps/mobile/src/contexts/AuthContext.tsx:58-77`; API client `apps/mobile/src/services/backendApi.ts:295`; `apps/mobile/assets/sounds/escalation-siren.wav` (5,644 bytes); bundling in `apps/mobile/app.json:76-78`; status labels `apps/mobile/src/utils/receiverStatus.ts`; `apps/mobile/src/app/(main)/escalations.tsx` is a 5-line redirect to `/(main)` |
| Data    | `escalation_events` (`attemptNumber`, `channel`, `result`, `senderNotifiedAt`, `backupAlertedAt`); `device_tokens` (unique `token`, `active`, `lastRegisteredAt`), migration `apps/backend/prisma/migrations/202605070001_device_tokens/migration.sql`, model `DeviceToken` at `schema.prisma:499-517`         |
| Tests   | `escalations.service.spec.ts`, `prisma-escalations.repository.spec.ts`, `notifications.service.spec.ts`, `check-ins.service.spec.ts` (exhaustion notifies once), `apps/mobile/src/services/pushNotifications.spec.ts`                                                                                          |

## Routes and contracts

- `POST /device-tokens` — sender, Supabase bearer. Body `{ token, platform: 'ios'|'android'|'web', deviceId? }`. Rejects anything not matching `/^Expo(nent)?PushToken\[...\]$/`; upserts by token; returns `{ deviceToken: { id, platform, active, registeredAt } }`.
- `PATCH /receivers/:receiverId/check-ins/:checkInId/alert-backup` — sender, Supabase bearer, sender-owned receiver only, and only for the receiver's latest check-in in `RESPONDED_HELP`, `FAILED` or `SKIPPED`. Runs `escalateSenderRequestedBackup`.
- There is no route for HELP escalation or cascade-exhaustion notification: both are internal, driven by inbound replies (`POST /receiver-replies/fake` in fake mode, the Twilio webhooks in configured mode) and by `POST /operations/check-ins/run`.

Audit actions this feature writes: `escalation.backup_contact_alerted`, `escalation.backup_contact_failed`, `escalation.no_backup_contacts`, `check_in.escalated`, `check_in.escalation_failed`, `check_in.escalation_skipped`, `sender_push.sent`, `sender_push.not_delivered`, `sender_push.failed`, `sender_push.skipped`, `sender_voice_fallback.sent`, `sender_voice_fallback.failed`, `push.device_token_registered`. `check_in.needs_attention` and `check_in.backup_alert_requested` are written by the check-ins and receivers modules that call in.

Metadata worth knowing: every `sender_push.*` (except `skipped`) and `sender_voice_fallback.*` row carries `deepLink` (the in-app route, ids only — CB-068); `sender_push.skipped` carries `reason: "sender_initiated"`; `escalation.backup_contact_alerted` / `_failed` carry `channel` (the channel of the event), `attemptedChannels` (comma-joined, in order, e.g. `"WHATSAPP,SMS"`) and `channelDetection` (`PRIMARY_AVAILABLE` / `FALLBACK_SELECTED` / `MANUAL_REQUIRED` from `resolveReachablePlan`), plus `renderedLanguage` / `renderFallback` on success.

## How to exercise it locally (fake mode)

- Set up `apps/backend/.env` per `docs/EMULATOR_RUNBOOK.md` §3 (`CHANNEL_PROVIDER_MODE=fake`, `OPERATIONS_CRON_SECRET`) and start the backend.
- HELP escalation: `POST /receiver-replies/fake` with `{"fromPhone":"<receiver>","channel":"SMS","body":"HELP"}` and the cron-secret bearer on an open check-in that has a backup contact. Expect exactly one `escalation_events` row per backup contact (`WHATSAPP`, `SUCCESS` — both fake providers claim every E.164 number, so WhatsApp wins in fake mode; in configured mode without WhatsApp credentials it is `SMS` with `channelDetection: "MANUAL_REQUIRED"` and still no ERROR row) and `check_in.escalated`. The alert body prints in the backend terminal as a `[fake-provider]` line and is listed by `GET /receiver-replies/fake/outbound` (cron-secret bearer).
- Cascade exhaustion: send the check-in, then re-run `POST /operations/check-ins/run` (cron-secret bearer) until every attempt times out. Expect `NEEDS_ATTENTION`, exactly one `check_in.needs_attention {reason:"cascade_exhausted"}`, one `sender_push.not_delivered {attempted:0, deepLink:"/(main)/receivers/<id>"}` and one `sender_voice_fallback.sent {reason:"cascade_exhausted", deepLink:"/(main)/receivers/<id>"}`. Re-running the tick adds nothing.
- Sender-requested alert: `PATCH /receivers/:id/check-ins/:cid/alert-backup` with a Supabase bearer from the app. Expect `check_in.backup_alert_requested`, then `sender_push.skipped {reason:"sender_initiated"}`, then the backup fan-out rows (or `escalation.no_backup_contacts`); no push and no voice call reach the sender.
- There is no fake push gateway: `ExpoPushGateway` always calls `https://exp.host/--/api/v2/push/send`. With no device token registered the observable path is `sender_push.not_delivered` → voice fallback; registering a token makes a real outbound Expo request.

## Invariants — do not break

- For HELP and missed-check-in escalations `notifySender` runs *before* the backup fan-out, and the `sentAt` it returns is stamped as `senderNotifiedAt` on every `escalation_event` created in that pass. A sender-requested alert skips the siren entirely (push and voice fallback), audits `sender_push.skipped {reason: "sender_initiated"}` and leaves `senderNotifiedAt` unset — the sender already knows (CB-074).
- One `escalation_event` per backup contact per pass. WhatsApp is attempted only when `resolveReachablePlan` answered with `detectionConfidence: 'provider_availability_check'`; an unconfigured WhatsApp provider throws from its availability check, the router reports `MANUAL_REQUIRED`, and SMS alone is tried — so a missing WhatsApp configuration can never produce an ERROR event. SMS is always the last channel tried; a contact no channel accepted gets a single ERROR event (`errorDetails: 'provider_send_failed'`) on that last channel.
- Backup alerts render in `receivers.language` trimmed of `char(5)` padding (blank → `en`). The catalog's English fallback still applies: the provider sees `language: 'ar'` while the audit row says `renderedLanguage: 'en', renderFallback: true`.
- Every `sender_push.sent` / `.not_delivered` / `.failed` and `sender_voice_fallback.sent` / `.failed` row carries `deepLink`. It is a route built from ids, never PII (CB-068).
- Voice fallback fires only when the push result is `sent === 0` or the push call throws. Zero active tokens is not an error path — it is `attempted: 0` plus the fallback.
- `notifySenderOfMissedCheckIn` must never fan out to backup contacts and must never write a check-in status (FR-BAK-03 reserves that for the sender's own action).
- Exhaustion notification is once-only because `markNeedsAttention` is a guarded `updateMany`; a second timed-out attempt, a replayed callback or a re-run tick finds the row already flagged and neither audits nor notifies.
- `escalateHelpResponse` has no terminal status: no contacts or all-failures leave the check-in `RESPONDED_HELP`. Only `escalateMissedCheckIn` passes `SKIPPED`/`FAILED`.
- Audit metadata stays PII-free — ids, statuses, counts, channels, reasons. `backupContactId` is an id and must remain allowed by the audit PII guard (it caused a 500 before CB-002).
- Backup-contact, receiver and sender phones are decrypted only at the moment of provider send.
- The sound filename `escalation-siren.wav` must stay identical in three places: the backend push payload, the Android channel in `pushNotifications.ts`, and the `expo-notifications` `sounds` array in `app.json`.
- `device_tokens.token` is unique; an Expo `DeviceNotRegistered` ticket must keep deactivating that row.
- `escalateMissedCheckIn` currently has no production caller (only specs). Do not wire it to cascade exhaustion — that is the contradiction CB-005 resolved against.

## Known gaps

- Android push cannot arrive at all: `apps/mobile/app.json` has no `android.googleServicesFile` and no FCM project exists (CB-031).
- Expo Go on Android is skipped by design (`Constants.appOwnership === 'expo'` returns early); Expo Go on SDK 53+ has no remote push, so a development build is required to see any push.
- iOS Critical Alerts entitlement is not implemented and Android DND bypass is off (`bypassDnd: false`); neither may be claimed as granted behaviour.
- CB-012 — no quiet (non-siren) sender pushes for consent, STOP or backup DONE.
- CB-023 — Expo gateway has no access token, no 100-message chunking, no timeout, no receipt polling; `platform` is free text.
- CB-030 — no foreground handler, no tap → deep-link navigation, no token unregister on sign-out, no permission-denied UX.
- CB-035 — no "Test my siren" control or DND/permission status surface.
- CB-038 — the bundled siren is a 0.35 s, 8 kHz blip; needs a real ≤ 30 s, 44.1 kHz siren at the same filename.
- CB-058 — no 5-minute sender-acknowledgement timeout that auto-alerts backups.
- CB-074 (app part) — the backend no longer sirens the sender on a sender-requested alert and returns `{ outcome, alerted, failed }`, but the receivers controller still answers with the receiver detail only and the app shows nothing after `Alert backup contacts` (emulator acceptance 2026-09-06 D4).
- `resolveReachablePlan` cannot tell "WhatsApp unconfigured" from "no channel claims this number": both are `MANUAL_REQUIRED`, and the Twilio WhatsApp availability check is an E.164 regex, not a real WhatsApp-capability lookup. Backup alerts treat both as "SMS only", which is right today but will need a finer signal once a real capability check exists.

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` §11 (lines 1498–1540, HELP escalation), §12 (1543–1581, missed check-in), §16 (1710–1740, terminal outcomes), §18 (1766–1793, status labels), §27 (2152–2194, sender actions), §29g (2477–2518, sender push and device tokens), slice 10 (line 3253, siren baseline), slice 4 (line ~3413, bundled siren + voice fallback), §0a (793–804, sprint 1).
- Acceptance: `docs/audits/2026-09-06/sprint1-acceptance.md` scenarios S5 and S8, defect D2.
- PRs: #18 (CB-002 audit PII guard unblocked HELP escalation in production wiring), #20 (CB-005 cascade exhaustion notifies the sender; dead `escalateOverdueCheckIns` removed), sprint 2 escalations PR (CB-011 one reachable-channel alert per backup contact in the receiver's language, CB-068 `deepLink` in sender audit rows, CB-074 backend: no sender siren on a sender-initiated alert, outcome returned).
- Related handoff: `docs/handoffs/backup-contacts.md` for backup-contact CRUD and the `DONE` reply that resolves an escalated check-in.
