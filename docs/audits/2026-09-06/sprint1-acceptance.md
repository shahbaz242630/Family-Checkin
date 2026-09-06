# Sprint 1 acceptance — backend over HTTP, fake providers, throwaway Postgres (2026-09-06)

Repo `master` @ `a9ebd77` (tree untouched; read-only pass). Backend driven twice, sequentially, on `http://localhost:3998`
with the prescribed env (`CHANNEL_PROVIDER_MODE=fake`, the all-zero KMS master key and the `cron-secret` fixture as the operations secret, plus
`TWILIO_AUTH_TOKEN=dummy-twilio-auth-token` so the signed Twilio webhook routes could be exercised). Database:
`postgres:16-alpine` on 56434, `npm run db:apply-all` (9/9 files applied) and `npm run db:check-invariants`
(12 checks, 630 assertions, 0 violations) both passed first. Full request/response/row dumps: `run-A.log` (compiled
build), `run-B.log` (tsx), boot logs `boot-a.*.log`, `boot-b.*.log`, `boot-configured.*.log`; driver `drive.mjs` + `lib.mjs`,
helpers `render.ts`, `review-safe.ts` (all in this folder).

Seeding: Supabase auth is unreachable, so users/receivers/backup contacts/subscription were inserted by SQL through
node `pg`, PII encrypted with the same AES-256-GCM layout as `CryptoService` (base64(iv12|tag16|ct)), lookups hashed
with sha256. Per run: sender U (ACTIVE subscription, so `hasPaidAccess` passes), R1 "Margaret" (SMS→VOICE, personal
note, backup contact B1 "Ahmed"), R2 `timezone='Dubai'`, R3 (SMS→WhatsApp→VOICE), R5 (SMS→VOICE, never replies),
R6 (VOICE_ONLY), R4 seeded later for REPORT. Every receiver: `scheduleTimeWindow {00:00–23:59}`, `daily`, consent GRANTED.
Run A used phones `+44740012340x/1x/2x`, run B `+44740012390x/1x/2x`; audit history is append-only so run B's tick
counts include run A's invalid receiver (`failed:2`).

Reading note: timestamps printed by the driver are shifted −4h (node-pg parses `timestamp(3)` as local time); the
DB stores UTC correctly (`select "createdAt"::text` → `2026-09-06 04:06:07.432`, matching Nest's 08:06 local log).

## Boot results

| Boot | Command | Result |
|---|---|---|
| (a) compiled | `npm run build` (exit 0, fresh `dist/`) then `node dist/main.js` | Booted: 14 modules, routes mapped incl. `POST /receiver-replies/fake`; served every scenario; process alive at the end; stderr 0 bytes; 0 ERROR/WARN log lines |
| (b) source | `npx tsx src/main.ts` | Same: all scenarios, alive at end, stderr 0 bytes, 0 ERROR/WARN |
| configured | `node dist/main.js` with `CHANNEL_PROVIDER_MODE=configured`, no `TWILIO_*` | Booted; `ReceiverRepliesController` never mapped; `POST /receiver-replies/fake` → 404 with or without bearer; `POST /operations/check-ins/run` no bearer → 401 |

`apps/backend/.env` exists and also defines `CHANNEL_PROVIDER_MODE`, `PORT`, `OPERATIONS_CRON_SECRET`; `dotenv/config`
does not override shell values, and the observed port/routes confirm the shell env won.

## Scenario results (identical on boots (a) and (b); values quoted from run A unless noted)

| Scenario | Item | Result | Evidence (status/body/rows) |
|---|---|---|---|
| S1 | CB-001 | PASS | no bearer → `401 {"message":"Operations cron bearer token is required"}`; wrong bearer → 401; `Bearer cron-secret` → `201 {"ok":true,"receiverId":"","action":"unknown_sender"}`. Configured boot: 404 (see above) |
| S2 | CB-004 | PASS | `POST /operations/check-ins/run` → `201 {"dueCheckIns":{"created":4,"sent":4,"skipped":0,"failed":1},"cascadeAttempts":{...0}}` (run B `failed:2`, two Dubai rows present). R1 check-in `03117fe2…` `SENT`, attempt 1 SMS `fake-SMS-message-1`, attempt 2 VOICE PENDING +30 min. R2 has no check-in. `audit_logs` `check_in.schedule_invalid` entity R2 `{"reason":"invalid_timezone"}`. `GET /` still 404 afterwards; process alive through 18 ticks |
| S3 | CB-010 | PASS (with observability gap, D1) | `check_in.sent` metadata `{"channel":"SMS","providerStatus":"accepted","renderedLanguage":"en","renderFallback":false}`. `channel_templates` has 0 rows, so the in-code English catalog is the source. Body reproduced with the same `MessageCatalogService` + the variables `CheckInsService.checkInMessageVariables` passes: `Hi Margaret, your family member is checking in on you today. Their note: "Remember your tablets, love from Sam" Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report.` Missing `receiverName` fails closed (`Message template checkin_daily requires variable "receiverName"`). Not `checkin_daily` |
| S4 | CB-015 | PASS | "Thanks, I'm fine" from R1 → `201 action:"unrecognised_reply"`, 1 audit `receiver.reply_unrecognised` (`bodyLength:16, normalizedReply:"UNKNOWN"`). Unknown `+447400123499` → `201 action:"unknown_sender"`, 1 audit `inbound_reply.unknown_sender` (`senderHashPrefix`). `fromPhone:"12345"` → `201 action:"invalid_sender"`, 1 audit `inbound_reply.invalid_sender`. Signed `POST /provider-webhooks/twilio/messaging` `MessageSid=SM-replay-A` → `{"processed":1}`, replay → `{"processed":0}`; `provider_webhook_events` 1 row (`payload {channel:"sms",bodyLength:"16",hasButtonPayload:"false"}`), 1 audit row for that SID. `From=12345` via the Twilio route → 201 |
| S5 | CB-002 + CB-010 | PASS | `HELP` from R1 → `201 {"action":"check_in_responded_help","checkInStatus":"RESPONDED_HELP"}`; DB check-in `ESCALATED`. `escalation_events` for `03117fe2…`: exactly 2 rows (SMS, WHATSAPP) both `SUCCESS` with `backupAlertedAt`. Audit: `check_in.responded_help`, `sender_push.not_delivered` (`attempted:0`, no device token), `sender_voice_fallback.sent` (`providerStatus:"accepted"`), 2× `escalation.backup_contact_alerted` (`backupContactId:"944afbe5…"`, `renderedLanguage:"en"`, `renderFallback:false`, `sourceChannel:"SMS"`), `check_in.escalated {successfulAlerts:1,failedAlerts:0}`. Attempt 2 SKIPPED `superseded_by_response`. Backup body (same catalog/variables as `backupAlertContext`): `Hi Ahmed, this is Nearby. Margaret asked for help during a check-in from their family member. We reached them by SMS. Please contact them now. Where to find them: Flat 2, key under the mat Reply DONE once you have reached them.` `DONE` from B1 → `201 {"action":"check_in_resolved_by_backup","checkInStatus":"RESOLVED"}`, `resolvedAt` set |
| S6 | CB-008 | PASS | R3 check-in `d0c8e438…` SENT with attempts 2 (WHATSAPP) and 3 (VOICE) PENDING. `STOP` → `201 {"action":"consent_revoked","consentStatus":"REVOKED"}`; attempts 2,3 → `SKIPPED` `failureReason:"receiver_opted_out"`; check-in `SKIPPED`; audit `check_in.cancelled {reason:"receiver_opted_out",skippedAttempts:2}`; receiver `consentStatus REVOKED`, `opt_out_cooldowns` row (`STOP`, +7 days). After moving that check-in to yesterday (to defeat the per-UTC-day dedupe) the next tick created nothing for R3 (`created:0`) |
| S7 | CB-007 | PASS | R4 seeded, tick → check-in SENT. `REPORT` → `201 action:"abuse_reported"`; receiver `pausedUntil` year 9999 (driver shows `9999-12-30T20:00Z`, the `9999-12-31T00:00Z` sentinel through the −4h reader shift), `pausedReason:"abuse_report_pending_review"`; open check-in `SKIPPED`, attempt 2 `SKIPPED abuse_reported`; `abuse_reports` row PENDING. Check-in moved to yesterday, tick → no new check-in. Admin route needs a Supabase admin JWT, so `AdminAbuseService.markSafe` was called through the real `AppModule` (`review-safe.ts`) → `REVIEWED_SAFE`, `pausedUntil/pausedReason` null, audit `reviewed_safe {receiverResumed:true}` (actor ADMIN); next tick → `created:1`, new check-in `66e430fd…` SENT |
| S8 | CB-005 + CB-006 | PASS (with observability gap, D2) | R5: attempt 1 aged 31 min + attempt 2 made due → tick `cascadeAttempts {timedOut:1,sent:1}`, attempt 1 `TIMED_OUT response_window_elapsed`, attempt 2 VOICE `SENT fake-VOICE-call-4`; attempt 2 aged → tick `{timedOut:1,needsAttention:1}`; check-in `NEEDS_ATTENTION`; audit exactly one `check_in.needs_attention {reason:"cascade_exhausted"}`, one `sender_push.not_delivered {attempted:0}`, one `sender_voice_fallback.sent {reason:"cascade_exhausted",providerStatus:"accepted"}`; re-run tick → all zero, no second notification, status unchanged. R6 (VOICE_ONLY): attempts 1 and 2 both SENT, `"1"` (YES) → `RESPONDED_OK`, attempt 2 RESPONDED, attempt 3 SKIPPED; signed `POST /provider-webhooks/twilio/voice/status {CallSid:"fake-VOICE-call-1",CallStatus:"no-answer"}` → `201 {"processed":1}`, attempt 1 → `FAILED twilio_status_no-answer`, check-in still `RESPONDED_OK`, no `check_in.needs_attention` row; replay for the answered attempt → still `RESPONDED_OK`; unsigned → 401 |
| S9 | CB-003 | PASS | `npx vitest run src/app.module.spec.ts` → 1 file, 8 tests passed (5.6 s) |

## Defects found

- D1 (observability, S3) — the fake provider's rendered body is not observable from the running process: `apps/backend/src/modules/channels/fake-channel.provider.ts:57-60` pushes to an in-memory `renderedMessages` array and nothing logs or persists it, so "logged/stored body" can only be proven by re-rendering offline (done above) or by unit spec. Backlog: in fake mode, persist the rendered body (and voice script) somewhere queryable (log line or `provider_webhook_events`-style row) so the emulator session can assert copy over HTTP.
- D2 (observability, S8) — `deepLink` never reaches an audit row: `apps/backend/src/modules/escalations/escalations.service.ts:442-455` audits `sender_push.*` with `receiverId/attempted/sent/failed/reason` only, and `sender_voice_fallback.sent` (`:513`) carries no link either; with no device token registered the observable path is `sender_push.not_delivered` → voice fallback. The "push whose `data.deepLink` opens the receiver" clause is covered only by `escalations.service.spec.ts`. Backlog: add `deepLink` (not PII) to the `sender_push.*` audit metadata and/or a fake push gateway in fake mode that records payloads.
- D3 (noise) — `check_in.schedule_invalid` is written on every tick for every invalid receiver with no dedupe: `apps/backend/src/modules/check-ins/check-ins.service.ts:91-100` (18 rows for one receiver over 18 ticks here; at the 10-minute cron that is 144 audit rows/day per bad row, forever) and the sender is never told. Backlog: audit once per UTC day (or until the row changes) and surface the invalid schedule to the sender.
- Observation (not a defect, by design of CB-004) — `dueCheckIns.failed` mixes schedule-invalid rows with provider send failures; a separate counter would make the ops summary readable.
- Out of scope / known — voice `voice_status` events have no dedupe (a second identical `no-answer` would store a second `provider_webhook_events` row); that is CB-016 (restore the unique index), not a sprint-1 item.
- Test-only limitation — `PATCH /admin/abuse-reports/:id/review-safe` cannot be driven without Supabase; verified through the service on the real DI graph.

## Cleanup

Backend processes (a), (b) and configured stopped (0 `node` processes with `dist/main.js`/`src/main.ts` left);
`docker rm -f nearby-accept-pg`; no files created outside this scratchpad folder; `git status` unchanged from the start
of the session (`.gitignore` modified and `docs/EMULATOR_RUNBOOK.md` untracked were pre-existing).
