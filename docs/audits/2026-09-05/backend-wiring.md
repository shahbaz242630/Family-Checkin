# Backend wiring & provider-readiness audit (apps/backend) — 2026-09-05

Method: traced every module controller -> service -> repository -> Prisma/HTTP; booted the real `AppModule`
(`CHANNEL_PROVIDER_MODE=fake`) against a throwaway Postgres built with `npm run db:apply-all`; seeded a sender,
two receivers, a subscription and a backup contact by SQL; drove the cron route, the reply path, the cascade,
and Twilio-signed webhooks with curl. Logs: `boot.log`, `curl.log` (pass 1), `curl2.log` (pass 2) in this folder.
All paths below are relative to `apps/backend/src/` unless stated.

## Executive summary

**Verdict: the DI graph, routes, Prisma layer and the cron/cascade loop are genuinely wired and work end to end in
fake mode. But the product's escalation promise is not shippable, and no channel provider is "credentials-only" away.**

Top blockers, in order:
1. **HELP escalation and backup-contact resolution crash in production wiring.** `AuditService` rejects any metadata key
   matching `/contact/i` (`modules/audit/audit.service.ts:5`); escalations and backup replies log `backupContactId`
   (`escalations.service.ts:302,333`, `receiver-reply.service.ts:334`). Empirically (curl2 step 8): messages were sent, an
   extra `ERROR provider_send_failed` escalation_event was written, the request returned 500 and the check-in was never
   marked ESCALATED. Same 500 on the backup contact's DONE reply. Every service spec stubs `AuditService`, so tests pass.
2. **Cascade exhaustion never notifies the sender.** `processCascadeAttempts` ends in `markCheckInNeedsAttention`
   (`check-ins.service.ts:382-394`) = DB status + audit only; `CheckInsService` has no `NotificationsService`. BRD
   FR-CHN-03c (siren push, 5-minute auto-escalation to backup contacts) is unimplemented. Empirically: R1 exhausted
   WhatsApp->SMS->VOICE -> `NEEDS_ATTENTION`, audit = `check_in.needs_attention`, 0 escalation events, no push.
   `escalateOverdueCheckIns` (`check-ins.service.ts:132`) is dead code — nothing calls it.
3. **`POST /receiver-replies/fake` is unauthenticated and registered in every mode** (`receiver-replies.controller.ts:22-27`,
   `receivers.module.ts:23`). Anyone who knows a receiver's phone can mark check-ins OK, file abuse reports, revoke consent
   (STOP) — proven with no headers in curl2 steps 12/12b.
4. **SMS bodies are raw template keys.** `renderTwilioMessage` (`channels/twilio-rendering.ts:3-9`) sends literally
   `"checkin_daily"` and `"backup_contact_missed_checkin_alert\ncheckInId: ...\nreceiverId: ..."`. The `channel_templates`
   table exists (`prisma/schema.prisma:449`) but nothing reads or writes it.
5. **WhatsApp language lookup is broken by `char(5)` padding.** Prisma returns `language: "en   "` (verified); the content
   SID key is `${templateKey}:${language}` (`whatsapp.provider.ts:73`) so `consent_request:en` in `.env.example` never
   matches and the send throws unless un-suffixed keys are also configured.
6. **Twilio voice Gather callback answers JSON, not TwiML** (`provider-webhooks.controller.ts:145-161`; curl2 step 10:
   `201 Content-Type: application/json`). Twilio raises 12100 and the receiver hears an application-error prompt.
7. **A late Twilio no-answer/AMD callback flips a RESPONDED_OK check-in to NEEDS_ATTENTION** (`recordVoiceProviderFailure`
   `check-ins.service.ts:241-247` never checks check-in status; reproduced in curl2 step 10b).
8. **`REPORT` does not stop check-ins.** `pauseForAbuseReview` sets only `pausedReason` (`prisma-receivers.repository.ts:369-378`);
   the due query filters on `pausedUntil` only (`prisma-check-ins.repository.ts:142`). Cron created a new check-in for the
   reported receiver (curl2 step 12).
9. **No delivery-status webhook for SMS/WhatsApp** and outbound sends set no `StatusCallback` (`sms.provider.ts:27-31`,
   `whatsapp.provider.ts:28-33`): undelivered messages look "sent" for the full 15/30-minute window.
10. **Voice needs assets that do not exist**: five `{lang}/{scriptKey}.wav` prompts per language (en/ar/es/hi/ur) must be
    hosted at `VOICE_AUDIO_BASE_URL`; the repo contains none (only the mobile siren).

## Per-module wiring

| Feature | Status | Evidence | What is missing |
|---|---|---|---|
| `app.module.ts` DI graph | Fully wired | Boot log: 14 modules initialised, 39 routes mapped; every `@Inject` token has a provider (`*.module.ts`) | `PrismaService` is a *module-local* provider in all 13 modules -> 13 `PrismaClient`/pg pools per process (Supabase direct-connection limits) |
| auth (`/auth/sync-user`, `/auth/admin/me`) | Fully wired | `supabase-auth.service.ts:36` GET `/auth/v1/user` with anon `apikey` + user bearer; `prisma-admin-users.repository.ts:25` | No local JWT verification -> 1 Supabase round-trip **and** a `users` upsert per request on every authed route; Supabase DNS failure -> 500 not 401/503 (curl step 4d); no fetch timeout; `SUPABASE_SERVICE_ROLE_KEY` is required by config (`app-config.service.ts:9`) but used nowhere |
| users | Fully wired | `prisma-users.repository.ts:11` upsert by `authProviderId` | Requires `phone` in Supabase user/metadata or 401 (`supabase-auth.service.ts:59`) |
| receivers CRUD/pause/resume/delete/resolve/alert-backup/try-later | Fully wired | `receivers.controller.ts:99-330`, `prisma-receivers.repository.ts` | `alert-backup` hits blocker 1 (500). `POST /receivers` creates then `requestConsent` (`:370`); if the send throws the receiver stays PENDING and there is no re-request route (`receiver-consent.service.ts:31` throws on retry). Sender display name = email (`:373`). `scheduleCustomCron` stored, never used (`prisma-check-ins.repository.ts:143` only `'daily'`) |
| receiver replies (`/receiver-replies/fake`) | Wired, **unauthenticated** | `receiver-replies.controller.ts:22`; curl2 steps 8/12/12b | Must be removed or gated to fake mode / a secret |
| receiver-reply service | Partially wired | `receiver-reply.service.ts:52-148` | Unknown text / unknown sender / replayed reply -> `throw Error` -> 500 (`:100,309,314,319`; curl2 8b/8d). No idempotency on `providerMessageId`. Opt-out cooldown written (`:134`) but never read anywhere. Blocker 8 (`REPORT`). Blocker 1 (DONE) |
| backup-contacts | Fully wired | `backup-contacts.controller.ts:45-124`, `prisma-backup-contacts.repository.ts` | Max-5 rule enforced (`backup-contacts.service.ts:87`); OK |
| check-ins (cron: `sendDueCheckIns`, `processCascadeAttempts`) | Fully wired | `check-ins.service.ts:65-224`; curl2 steps 7/7c/9-9c | No per-receiver try/catch in `sendDueCheckIns` (`:70-127`): one provider throw aborts the batch with 500, leaves the check-in PENDING and skips remaining receivers (observed in pass 1; the next cascade run self-heals attempt 1). Cascade offsets hard-coded (`:306,323`) vs BRD "configurable per receiver". `hasPendingAttempts` scans all pending attempts with a year-9999 date (`:377`). One-per-UTC-day dedupe (`prisma-check-ins.repository.ts:484`) vs local-tz window can double-send across UTC midnight |
| check-ins voice callbacks | Partially wired | `recordVoiceProviderFailure` `:226-250` | Blocker 7 |
| escalations | **Broken in prod wiring** | `escalations.service.ts:130-260`; curl2 step 8 | Blocker 1. Alerts every backup contact on SMS **and** WhatsApp simultaneously (`:36,197`) regardless of capability -> guaranteed WhatsApp errors/cost for non-WA numbers. Language hard-coded `'en'` (`:277`). Backup message variables are UUIDs (`:278-281`), not name/address |
| notifications (`POST /device-tokens`, push) | Fully wired | `notifications.controller.ts:24`, `expo-push.gateway.ts:29`, `prisma-notifications.repository.ts:57` | Push only fires from `EscalationsService` (help / sender-requested); never on cascade exhaustion (blocker 2). No spec for controller/gateway |
| billing (`/billing/status`, RevenueCat webhook) | Fully wired | `billing.controller.ts:43`, `billing.service.ts:62`, idempotency via `idempotency_keys` (`prisma-billing.repository.ts:29`) | Auth compare is `!==` not timing-safe (`billing.controller.ts:63`). Tier/interval inferred by regex on product id (`billing.service.ts:157-168`). `app_user_id` must equal backend `users.id` |
| account (step-up OTP, export, delete) | Fully wired | `account.controller.ts`, `step-up.service.ts:40` sends OTP via SMS | OTP SMS body is `"account_step_up_otp\ncode: 123456\naction: ..."` (blocker 4) |
| admin-abuse | Fully wired | `admin-abuse.controller.ts:17-71`, role check `:6` | Reviewing a report does not unpause / resume the receiver |
| audit | Fully wired | `audit.service.ts:13`, append-only table (invariant G) | PII guard key regex is too broad (`contact`, `name`) — root cause of blocker 1 |
| operations (`/operations/check-ins/run`, summary, detail) | Fully wired | `operations.controller.ts:37-74`; curl2 step 7 | Run route does not call `escalateOverdueCheckIns` (dead) — by design per BRD FR-BAK-03, but see blocker 2 |
| provider-webhooks | Partially wired | `provider-webhooks.controller.ts:91-203` | Blockers 6, 9; `provider_webhook_events` has no dedupe (index made non-unique in `prisma/migrations/202609050001…`, repo never checks) -> 2 rows for one `providerEventId` (curl2 10b). `/whatsapp` (Meta shape) has no GET `hub.challenge` handler (404, curl 3d) and expects a custom header, not `X-Hub-Signature-256` |
| channels | Fully wired (fake) / partially (configured) | `channels.module.ts:9-14`, `channel-providers.factory.ts:9-37` | See provider table |

## Provider readiness ("credentials-only away from working?")

| Provider | Interface / impl / fake / factory | Env required | Outbound call | Inbound | Tests | Verdict |
|---|---|---|---|---|---|---|
| **SMS (Twilio)** | `channel-provider.ts:31`; `sms.provider.ts`; `fake-channel.provider.ts`; factory `:25` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM_NUMBER` | `POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json`, form-encoded, Basic `sid:token` (`twilio-http-client.ts:8-15`) — **correct shape**. No timeout, no retry, error text discards Twilio `code/message` (`:17-20`). API-key (SK) auth unsupported | `POST /provider-webhooks/twilio/messaging` HMAC-SHA1(url+sorted params) base64, timing-safe (`:331-360`) — correct; tampered body rejected (curl2 11). No `MessageStatus` route | `configured-channel-providers.spec.ts:54-90` asserts URL/params via fake http client | **NO** — bodies are template keys (blocker 4); no delivery status; Twilio URL must be exactly `${PUBLIC_API_BASE_URL}/provider-webhooks/twilio/messaging` |
| **Generic `SMS_PROVIDER_*`** | config only (`app-config.service.ts:13-14`) | — | none | `POST /provider-webhooks/sms` + `x-nearby-webhook-secret` | controller spec | **NO** — dead config; route is an internal JSON contract, no real provider speaks it |
| **WhatsApp (Twilio Content API)** | `whatsapp.provider.ts`; factory `:19` | + `TWILIO_WHATSAPP_FROM_NUMBER`, `TWILIO_WHATSAPP_CONTENT_SIDS` JSON | Messages.json with `To/From=whatsapp:+…`, `ContentSid`, `ContentVariables` JSON — correct shape. Variable names sent are app keys (`senderDisplayName`, `checkInId`…) so every template must be authored with those exact variable names | same Twilio messaging route; `ButtonPayload` preferred (`:278`) | spec `:93-148` | **NO** — blocker 5 (padding), 8 templates x languages must be approved (`consent_request`, `checkin_daily`, 3 x `backup_contact_*`, `receiver_checkins_paused/ended`), no status callback |
| **WhatsApp (Meta Cloud API)** | none | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` parsed (`:22-23`), never read | none — no Graph API client exists | `/provider-webhooks/whatsapp` parses Meta payload shape but auths with a custom header; no GET verification | controller spec | **NO** — not implemented; delete or build |
| **Voice (Twilio)** | `voice.provider.ts`; factory `:30`; sticky caller ID `prisma-voice-caller-id.repository.ts` | + `TWILIO_VOICE_FROM_NUMBER`, `PUBLIC_API_BASE_URL`, `VOICE_AUDIO_BASE_URL` | `Calls.json` with inline `Twiml`, `MachineDetection=Enable`, `AsyncAmd`, `AsyncAmdStatusCallback`, `StatusCallback(+Event/Method)` — parameter names correct; TwiML `<Gather input="dtmf" numDigits="1" timeout="10"><Play>…wav</Play></Gather>` x2 `<Hangup/>` valid | `/twilio/voice` (Digits), `/voice/status`, `/voice/amd` signed — signature OK | spec `:150-250` | **NO** — blockers 6, 7, 10; `VOICE_PROVIDER_*` config dead; `voice_caller_id_pool` has no writer (manual SQL seeding, `complianceStatus='APPROVED'` string) |
| **Expo push** | `expo-push.gateway.ts` (no interface/fake; specs pass a function) | none | `POST https://exp.host/--/api/v2/push/send` JSON array; maps `status/details.error` — correct | n/a | `notifications.service.spec.ts` (gateway itself untested) | **YES for delivery**, with caveats: no `Authorization: Bearer <EXPO_ACCESS_TOKEN>` (needed if Expo push security is enabled), no 100-message chunking, no receipt polling, no timeout |
| **RevenueCat** | `billing.controller.ts:43` | `REVENUECAT_WEBHOOK_AUTH_TOKEN`, optional `REVENUECAT_ENTITLEMENT_ID` | inbound only | Bearer/raw header compare; event idempotency; status mapping `billing.service.ts:135-155` | controller + service specs | **YES** (set RC app user id = backend user id; compare not timing-safe) |
| **Supabase auth** | `supabase-auth.service.ts` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | GET `/auth/v1/user` | n/a | spec | **YES**, but per-request network hop + DB upsert; `SUPABASE_SERVICE_ROLE_KEY` demanded and unused |

## Scheduler / cron chain

`GitHub Actions (*/10) -> scripts/run-operations-check-ins.ts -> POST /operations/check-ins/run (Bearer OPERATIONS_CRON_SECRET, @SkipThrottle)
-> CheckInsService.sendDueCheckIns -> processCascadeAttempts`. Verified in fake mode (curl2): run #1 created 2 / sent 2; run #2
created 0 (UTC-day dedupe works); ageing attempts produced `timedOut 1 / sent 1` twice then `timedOut 1 / needsAttention 1`;
attempts carry provider ids/status. With configured providers the same chain executes, and every failure of a
single send in `sendDueCheckIns` is unhandled (500, batch aborted). **The chain never reaches `EscalationsService` or
`NotificationsService`** — escalation only happens from an inbound HELP reply or the sender's `alert-backup` tap, and
both of those paths currently 500 (blocker 1). `escalateOverdueCheckIns` is unreachable. The
`operations-check-ins.yml` workflow exists but is expected to be disabled by GitHub inactivity until re-enabled.

## Data layer

- Production modules bind Prisma repositories everywhere (`provide: X_REPOSITORY, useClass: PrismaX…` in each `*.module.ts`);
  in-memory repositories exist only in specs. `db:apply-all` on a clean postgres:16 applied 9 Prisma migrations + 7 manual
  SQL files; `db:check-invariants` passed 12 checks / 630 assertions (RLS on 124 tables, audit append-only, partitions).
  `db:drift-check` needs `SHADOW_DATABASE_URL` (not run here; CI runs it).
- Tables/columns no code touches: `channel_templates` (whole table), `co_monitors` (BRD co-sender feature absent),
  `users.stripeCustomerId/telrCustomerId`, `receivers.scheduleCustomCron` (stored, ignored), `voice_caller_id_pool`
  (read/updated, never inserted), `opt_out_cooldowns` (written, never enforced), `check_ins.resolutionNote` (never set).
- No code references enums/columns missing from the schema (Prisma client compiled; boot succeeded; `check-invariants J/K`
  confirm migrations = repo).
- Repository methods ignoring arguments: none found. Suspicious: `markSentAttemptProviderFailure` matches by
  `providerMessageId` only (`prisma-check-ins.repository.ts:268`) — fake ids collide across receivers; Twilio SIDs are unique.
- `char(5)` for `language`/`preferredLanguage` returns padded strings through Prisma (blocker 5).

## Tests

- Suite: 46 spec files. No spec: `expo-push.gateway.ts`, `notifications.controller.ts`, `twilio-http-client.ts`,
  `twilio-rendering.ts` (only via provider specs), `prisma-notifications.repository.ts`, `prisma-users.repository.ts`,
  `prisma-account.repository.ts`, `prisma.service.ts`. Nothing boots `AppModule` (DI graph only proven by my manual boot).
- Specs that only exercise fakes: every service spec injects `InMemoryAuditService`/`FakeAuditService` (grep: 20+ sites) —
  only `audit.service.spec.ts` runs the PII guard, which is why blocker 1 is invisible. `check-ins`, `escalations`,
  `receiver-consent`, `receivers`, `step-up` specs use `FakeChannelProvider`; `provider-webhooks.controller.spec` stubs
  `ReceiverReplyService`; `configured-channel-providers.spec` uses a fake `TwilioHttpClient` (asserts request shape — good).
  Prisma repository specs use hand-written in-memory Prisma client interfaces, not a database.

## Boot / curl log summary (fake mode, port 3999, postgres:16-alpine on 56433)

- Boot: `npx tsx src/main.ts` with the prescribed env -> all modules initialised, routes mapped, no warnings (`boot.log`).
- `GET /` 404 JSON. `POST /operations/check-ins/run` no/wrong bearer -> 401; correct bearer -> 201 `{ok, dueCheckIns, cascadeAttempts}`.
- `POST /provider-webhooks/twilio/messaging` no signature -> 401; valid signature + tampered body -> 401 "invalid".
- `POST /provider-webhooks/sms|whatsapp` without `x-nearby-webhook-secret` -> 401. `GET /provider-webhooks/whatsapp?hub.challenge` -> 404.
- `GET /billing/status`, `POST /billing/revenuecat/webhook`, `POST /device-tokens`, `GET /receivers` unauthenticated -> 401.
- `GET /operations/check-ins/summary` with cron secret -> 500 (Supabase host unreachable -> unhandled `fetch failed`).
- `POST /receiver-replies/fake` with no auth -> executed (`abuse_reported`, `consent_revoked` returned 201).
- Cron/cascade pass: see "Scheduler" above. HELP reply -> 500 + `sender_push.not_delivered`, `sender_voice_fallback.sent`
  audits, escalation_events SUCCESS+ERROR pairs, check-in left un-escalated. Signed voice Digits=1 -> 201 JSON, check-in
  RESPONDED_OK; signed `voice/status no-answer` -> attempt 3 FAILED `twilio_status_no-answer`, check-in flipped to
  NEEDS_ATTENTION, duplicate delivery stored twice.
- Cleanup: process 51196 killed, `nearby-audit-pg` removed. No repo files modified.
