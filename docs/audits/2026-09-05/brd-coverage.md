# BRD Coverage Matrix — Nearby (branch codex/production-readiness-gaps, 2026-09-05)

Scope: every requirement in `Business Requirements Document.txt` v2.1 vs. code in `apps/backend`, `apps/mobile`, `packages/shared-types`, `apps/backend/prisma`, `supabase/migrations`. Evidence is `file:line`; `B/` = `apps/backend/src`, `M/` = `apps/mobile/src`. "Done" = code + unit test exist and behaviour matches the BRD. "Unverified" = cannot be confirmed without live credentials/devices.

## Executive summary

Counts (matrix rows below): **Done 20 · Partial 65 · Missing 21 · Not applicable/ops 5 · Unverified 1** (112 rows). Phase 2/3 items (co-monitoring, conversational voice, human escalation) are counted as Missing but are out of Phase 1 scope.

The foundation is real: encrypted persistence, consent gate, one state machine for check-ins/attempts, Twilio providers behind a clean `ChannelProvider` interface, append-only audit log with RLS invariants in CI, step-up OTP for sensitive actions, RevenueCat entitlement gate, Expo siren push. Backend unit coverage of what exists is decent (every service has a spec). But several **launch-critical journeys are wired only half-way**, and a few are actively wrong:

1. **Cascade exhaustion never notifies the sender.** `markCheckInNeedsAttention` only writes an audit row (`B/modules/check-ins/check-ins.service.ts:382-394`); the siren push lives in `EscalationsService.notifySender`, reached only for HELP replies / sender-requested alerts. `escalateOverdueCheckIns` (`:132-167`) has no callers. Journey 4.3 ("we haven't heard from Salma") does not happen.
2. **REPORT does not pause check-ins.** `pauseForAbuseReview` sets only `pausedReason` (`B/modules/receivers/prisma-receivers.repository.ts:370-379`); eligibility checks only `pausedUntil` (`check-ins.service.ts:259`, `prisma-check-ins.repository.ts:142`). FR-SAF-05 is not enforced.
3. **STOP mid-cascade does not cancel pending SMS/voice attempts** (`B/modules/receivers/receiver-reply.service.ts:98-147` never calls `skipPendingAttemptsForCheckIn`; `processCascadeAttempts` checks only check-in status, `check-ins.service.ts:192-201`). Same gap for pause/delete/REPORT.
4. **Opt-out cooldown is written but never read** (`receiver-reply.service.ts:133-141`; no reader anywhere; no re-invite endpoint; `receiver-consent.service.ts:31` forbids a second request). FR-SAF-07 unenforced.
5. **Outbound SMS text is the template key** (`B/modules/channels/twilio-rendering.ts:3-9` renders `checkin_daily` plus `key: value` lines). No localized human copy for SMS/consent/pause/ended/OTP/backup alerts; `ChannelTemplate` table unused. Backup alerts are `language: en` with only internal IDs (`B/modules/escalations/escalations.service.ts:275-282`), not name/address/channels tried.
6. **Personal note is stored but never sent** (`check-ins.service.ts:288-292` sends `variables: {}`).
7. **Voice path unverified and likely broken live**: the Gather `action` endpoint returns JSON, not TwiML (`B/modules/provider-webhooks/provider-webhooks.controller.ts:145-161`); unknown replies throw → HTTP 500 to Twilio (`receiver-reply.service.ts:99-101`); `9` / "stop calling" opt-out unmapped; audio folders only en/ar/es/hi/ur (`twilio-rendering.ts:35-51`), so Malayalam/Tamil/Bengali play English.
8. **Scheduler is a GitHub Actions cron every 10 min, currently disabled** (`.github/workflows/operations-check-ins.yml:12`, `docs/SECURITY.md` §7). No BullMQ/queue; consent SMS and step-up OTP are sent synchronously inside request handlers.
9. **Billing diverges from BRD**: RevenueCat/App Store/Play instead of Stripe+Telr; no tier config, no per-tier limits, no in-app cancel.
10. **Deletion/retention**: account delete anonymizes immediately (no 30-day window, no final receiver message, device tokens/subscriptions untouched); archive SQL exists but nothing schedules it; no user hard-delete job.

Top 10 to finish first (closest to done × most important): (1) wire siren push + voice fallback into cascade exhaustion; delete dead `escalateOverdueCheckIns`; (2) make REPORT pause real (`pausedUntil`) and unpause on REVIEWED_SAFE; (3) one helper that skips pending attempts, called from STOP/REPORT/pause/delete; (4) enforce opt-out cooldown + 1 invite/week on create and add a re-invite endpoint; (5) real per-language message catalog for SMS/consent/pause/ended/OTP/backup alerts incl. personal note and backup context; (6) quiet sender pushes for consent accepted/declined/opt-out/backup DONE; (7) voice webhook returns TwiML, maps `9`→STOP, never 500s, adds ml/ta/bn audio; (8) mobile notification-tap deep link to receiver detail, "Test my siren", pause end-date picker, 30-day history; (9) receiver-local day dedupe + every_other_day/weekly + configurable cascade offsets/quiet hours; (10) deletion/retention jobs (final receiver notice, 30-day hard delete, archive cron, purge device tokens).

## Coverage matrix

| Id | Requirement (short) | Status | Evidence | Remaining work |
|---|---|---|---|---|
| BRD-4.1 | Journey: sign up → add receiver → consent → first check-in | Partial | `M/app/(auth)/signup.tsx`, `M/app/(auth)/onboarding.tsx`, `B/modules/receivers/receivers.controller.ts:330-394` | Phone OTP missing; consent text = template key/Content SID; no "accepted" push; sender shown as email (`receivers.controller.ts:373`). |
| BRD-4.2 | Journey: feature-phone receiver (SMS/voice profiles) | Partial | `M/utils/channelProfiles.ts`, `B/modules/check-ins/check-ins.service.ts:300-332` | SMS body not human copy; voice audio only en/ar/es/hi/ur. |
| BRD-4.3 | Journey: no response → 3 channels → sender notified with 3 options | Partial | `check-ins.service.ts:169-224, 382-394`; `M/app/(main)/receivers/[id].tsx:191-240` | **No push at cascade exhaustion**; try-later retries in 15 min (`receivers.service.ts:439`) vs BRD 2 h. |
| BRD-4.4 | Journey: alert backup → DONE → sender informed → resolve with note | Partial | `escalations.service.ts:111-128`, `receiver-reply.service.ts:302-350` | Alert lacks name/address/tried channels; backup DONE does not notify sender; no resolution note capture. |
| BRD-4.5 | Journey: receiver STOP → stops, confirms, notifies sender, fresh consent needed | Partial | `receiver-reply.service.ts:98-147` | No confirmation to receiver; no sender push; in-flight attempts continue; no re-consent flow; cooldown unread. |
| BRD-4.6 | Journey: pause with end date, receiver informed, auto-resume | Partial | `receivers.service.ts:236-277`, `prisma-check-ins.repository.ts:142` | Mobile pause has no end-date picker (`receivers/[id].tsx:177-189`); pause notice body is template key. |
| BRD-4.7 | Journey: co-monitoring (Phase 2) | Missing | schema `CoMonitor` + RLS only | Phase 2; no invite/accept API or UI. |
| FR-AUTH-01 | Email + phone signup, SMS OTP, magic link | Partial | `M/services/auth.ts:54-83`, `B/modules/auth/supabase-auth.service.ts:58-61` | Phone stored as metadata, never OTP-verified (`phoneVerifiedAt` never set); email confirm relies on Supabase config (unverified). |
| FR-AUTH-02 | Google/Apple sign-in | Done (unverified live) | `M/services/auth.ts:104-214`, `M/app/(auth)/login.tsx:88-89` | Verify OAuth redirect on device builds. |
| FR-AUTH-03 | Step-up OTP on delete account / export / remove receiver / payment change | Partial | `B/modules/account/step-up.service.ts`, `account.controller.ts:25-77`, `receivers.controller.ts:410-424`; specs | Payment-method change is store-managed (N/A); OTP SMS body is template-key text. |
| FR-AUTH-04 | Account deletion (PII gone ≤30 d, receivers anonymized) + export | Partial | `account-privacy.service.ts:45-107`, `prisma-account.repository.ts:229-289`; specs | No 30-day soft window/hard-delete job; no final message to receivers; device tokens, step-up rows, subscriptions not purged. |
| FR-REC-01 | Add receiver with all fields | Done | `receivers.service.ts:154-179, 597-660`; `receivers.service.spec.ts:320` | — |
| FR-REC-02 | WhatsApp auto-detect at setup | Partial | `channel-router.service.ts:47-83`, `whatsapp.provider.ts:48-51` | "Availability" is an E.164 regex; no real WhatsApp contact check (Twilio offers none) — decide/document manual selection. |
| FR-REC-03 | Three tech profiles + override | Done | `M/utils/channelProfiles.ts`, `check-ins.service.ts:305-331`; spec `:585` | Extra `LANDLINE` profile beyond BRD (fine). |
| FR-REC-04 | Mandatory consent message on primary channel, YES required, transcript logged | Partial | `receiver-consent.service.ts:30-72`, `receiver-reply.service.ts:98-131`; specs | Consent copy not localized for SMS/voice; sender name = email; no sender notification on YES/NO. |
| FR-REC-05 | Personal note (≤50 chars) in receiver messages | Partial | `receivers.service.ts:557-575`, `check-ins.service.ts:288-292` | Never rendered into any outbound message; no 50-char validation; not editable. |
| FR-REC-06 | Schedule per receiver (daily/EOD/weekly/custom) in receiver-local window | Partial | `prisma-check-ins.repository.ts:136-173, 432-489`; spec | Only `daily` scheduled (`:143`); once-per-day uses UTC day (`:484-489`), not receiver-local; UI hardcodes daily. |
| FR-REC-07 | Pause/resume with optional end date; receiver notified | Partial | `receivers.service.ts:236-301`; spec `:694` | Mobile lacks end-date input; pause does not skip in-flight attempts. |
| FR-REC-08 | Edit/delete receiver; final notice on delete | Done | `receivers.service.ts:205-338`; spec `:837` | Notice body needs real copy (see FR-CHN-02); phone/note not editable. |
| FR-BAK-01 | ≤5 backups/receiver with name, phone, relationship, address/instructions | Done | `backup-contacts.service.ts:14,76-112`; `receivers/[id].tsx:274-324`; specs | — |
| FR-BAK-02 | Backups reached by SMS+WhatsApp, no app | Done | `escalations.service.ts:36,195-217`; spec `:254` | Content SIDs for `backup_contact_*` templates must exist or the WhatsApp leg throws (`whatsapp.provider.ts:72-80`). |
| FR-BAK-03 | Backups alerted only after cascade failed AND sender chose | Done (by omission) | `receivers.service.ts:389-425`; `escalateMissedCheckIn` unwired | HELP reply auto-alerts backups (BRD 03c allows). Keep `escalateMissedCheckIn` unwired or delete it. |
| FR-CSC-01 | Cascade fires at scheduled time | Partial | `operations.controller.ts:37-50`, `.github/workflows/operations-check-ins.yml:12` | 10-min GitHub cron, disabled for inactivity; needs hosted minute-level durable scheduler. |
| FR-CSC-02 | Positive reply closes silently, cancels pending | Done | `receiver-reply.service.ts:237-275`; spec `:703` | — |
| FR-CSC-03 | WA → 15 m → SMS → 30 m → voice → 30 m → sender; configurable per receiver | Partial | `check-ins.service.ts:300-332, 401-407` | Offsets/timeouts hardcoded; no per-receiver columns; final "notify sender" step missing (see BRD-4.3). |
| FR-CSC-04 | Sender gets ONE notification with try-later / alert backup / mark OK | Partial | `receivers.controller.ts:252-328`; `receivers/[id].tsx:191-240`; specs | Notification itself never sent for exhausted cascade; try-later allowed while `SENT` (duplicate cascades). |
| FR-CSC-05 | Backup alert SMS+WA with who/where/what was tried | Partial | `escalations.service.ts:262-340` | Variables are only `checkInId/receiverId`; language `en`; add receiver name, address/instructions, channels tried, DONE instruction, receiver language. |
| FR-CSC-06 | Resolution with optional note by sender or backup; audited | Partial | `receivers.service.ts:340-387`, `receiver-reply.service.ts:302-350` | `resolutionNote` column never written; backup reply text not captured/forwarded; sender not pushed on backup DONE. |
| FR-CSC-07 | Max one cascade per day | Partial | `prisma-check-ins.repository.ts:143-153` | Day boundary is UTC; try-later intentionally adds a second cascade — acceptable but document. |
| FR-CHN-01 | WhatsApp Utility templates with OK/HELP buttons | Partial (unverified) | `whatsapp.provider.ts:22-42`, `provider-webhooks.controller.ts:273-297`; spec `:241` | Button payloads must equal English keywords (`receiver-reply.service.ts:150-165`); `.env.example` lists only consent/checkin SIDs; Meta approval external. |
| FR-CHN-02 | SMS with 1/2/STOP keywords, human text | Partial | `sms.provider.ts:22-40`, `twilio-rendering.ts:3-9` | Body is literally the template key + `key: value` lines; needs per-language copy incl. REPORT/STOP footer. |
| FR-CHN-03 | Short DTMF voice call in receiver language | Partial (unverified) | `voice.provider.ts:28-58`, `twilio-rendering.ts:11-24`, `provider-webhooks.controller.ts:145-161` | Gather action returns JSON not TwiML; no audio assets in repo; only 5 language folders. |
| FR-CHN-03a | TwiML repeat-once, DTMF 1/2, sticky caller-ID pool, retry 15 m ×2, quiet hours | Partial | `twilio-rendering.ts:23`, `prisma-voice-caller-id.repository.ts:39-79` (spec), `check-ins.service.ts:305-311` | Quiet hours missing; retries fire by fixed offset, not on call outcome; no `9` opt-out. |
| FR-CHN-03b | Reuse attempts table; store CallSid/status/failure; durable scheduler; lean/partitioned tables | Partial | schema `CheckInAttempt`, `provider-webhooks.controller.ts:163-203`, `supabase/migrations/20260510181345_*.sql` | AMD result only in webhook payload/failureReason; no queue; archive function never scheduled. |
| FR-CHN-03c-1 | Single session state; any OK closes & cancels; HELP escalates | Partial | `receiver-reply.service.ts:237-300`, `check-ins.service.ts:423-434` | Localized OK/HELP keywords missing; unknown reply throws 500; STOP does not cancel attempts. |
| FR-CHN-03c-2 | Twilio AMD; machine ≠ human; stored & used | Partial | `voice.provider.ts:42-45`, `check-ins.service.ts:226-250, 409-421`; spec `:688,731` | Persist AMD result on the attempt (dedicated column) rather than only failureReason. |
| FR-CHN-03c-3 | Escalation siren push (Time Sensitive / high channel, deep link, no PII) | Partial | `notifications.service.ts:100-115`, `escalations.service.ts:342-414`; spec | Not triggered on cascade exhaustion; deep link is `/(main)`; app has no notification-tap handler (`M/app/_layout.tsx:25-44` handles auth links only). |
| FR-CHN-03c-4 | iOS Critical Alerts entitlement + payload | Missing | `apps/mobile/app.json` (no entitlement) | Business request to Apple, then entitlement + critical interruption path. |
| FR-CHN-03c-5 | Android emergency channel, DND-bypass detection + guidance | Partial | `M/services/pushNotifications.ts:74-88` | `bypassDnd:false`, no capability detection, no settings guidance. |
| FR-CHN-03c-6 | "Test my siren" control in settings | Missing | — | Add settings action that fires a local siren notification and reports DND/critical status. |
| FR-CHN-03c-7 | Fallback voice call to sender when push unavailable | Partial | `escalations.service.ts:416-456`; spec `:372` | Only on push failure inside backup escalation; script `sender_escalation_siren_voice` audio absent; not on cascade exhaustion. |
| FR-CHN-03c-8 | 5-min ack timeout → auto-alert backups | Missing | — | Needs ack endpoint + timer/worker. |
| FR-CHN-04 | Conversational AI voice (Phase 2) | Missing | — | Phase 2. |
| FR-CHN-05 | Per-receiver channel order override | Partial | `receivers.controller.ts:188-224` accepts any order; `M/utils/channelProfiles.ts` | UI offers only 4 presets; no custom ordering. |
| FR-DSB-01 | Cards: name, relationship, today status, time since last contact | Partial | `M/app/(main)/index.tsx:104-160`, `M/utils/receiverStatus.ts` | "Time since last contact" not shown; schedule shows window start only. |
| FR-DSB-02 | Detail: 30-day history, escalations, schedule, channel, backups, quick actions | Partial | `M/app/(main)/receivers/[id].tsx`; `GET /receivers/:id` | Only latest check-in; no history/escalation list; no "message manually". |
| FR-DSB-03 | Push only on escalation events | Partial | `escalations.service.ts:342-414` | Missing the main event (cascade exhausted); missing quiet consent/opt-out/backup-DONE pushes. |
| FR-DSB-04 | Settings: profile, payment, notification prefs, language, delete, export, terms, privacy | Partial | `M/components/layout/ProfileMenu.tsx:13-18`, `M/app/(main)/settings/*` | Language screen is local state only (`language.tsx:17`); no notification prefs; terms/privacy only on signup with placeholder URLs (`signup.tsx:131-137`). |
| FR-SAF-01 | No check-in before YES | Done | `prisma-check-ins.repository.ts:140`, `check-ins.service.ts:253`; spec `:407` | — |
| FR-SAF-02 | Unilateral opt-out (STOP / "stop calling" / press 9), immediate, irreversible without fresh consent | Partial | `receiver-reply.service.ts:133-141`; spec `:595` | Voice `9`/speech not mapped; pending attempts not cancelled; no confirmation message; re-consent path absent. |
| FR-SAF-03 | Spouse mutual consent via verified call | Missing | grep: no spouse logic outside enum | Add spouse gate (extra voice-consent step) before scheduling. |
| FR-SAF-04 | Immutable audit of every action with actor & metadata | Partial | `audit.service.ts`, `prisma/supabase_setup.sql:6-19`, `scripts/db/check-invariants.mjs` | Admin reads, step-up request/verify, unknown replies, data export not logged. |
| FR-SAF-05 | REPORT → admin queue + automatic pause pending review | Partial (defect) | `receiver-reply.service.ts:203-235`, `prisma-receivers.repository.ts:370-379`, `admin-abuse.service.ts` | Pause not effective (only `pausedReason`); review "safe" does not unpause; no "contact sender"/notes. |
| FR-SAF-06 | Not-an-emergency disclaimer (onboarding, terms, settings, dashboard) | Done | `index.tsx:92-94`, `onboarding.tsx:129`, `data-privacy.tsx:208` | Terms document is external. |
| FR-SAF-07 | 7-day cooldown after opt-out; ≤1 invite/week/receiver | Partial | `receiver-reply.service.ts:133-141` (write only) | Read cooldown by phoneHash on create; add re-invite endpoint with weekly cap. |
| FR-BIL-01 | Three tiers from editable config; feature limits | Partial | `billing.service.ts:157-169`, schema `SubscriptionTier` | Tier derived by regex on product id; no config; no receiver/backup limits per tier (`shared-types/constants` limits unused). |
| FR-BIL-02 | Stripe primary + Telr fallback for UAE cards | Missing (superseded) | `billing.controller.ts:43-52` RevenueCat webhook | Product decision needed: BRD says Stripe/Telr; code is App Store/Play via RevenueCat. |
| FR-BIL-03 | Trial with card on file | Partial (unverified) | `billing.service.ts:92,123-125` | Trial defined in store products; untestable until RevenueCat products exist. |
| FR-BIL-04 | One-tap cancel, access to period end | Partial | `billing.service.ts:126-128`; `settings/billing.tsx:176` | No in-app manage/cancel link (open store subscription page). |
| FR-BIL-05 | VAT UAE/KSA invoices | N/A (store-handled) | — | Only relevant if the Stripe path is adopted. |
| FR-LNG-01 | Sender app in English at launch | Done | all screens English | Language stub screen should be hidden or wired. |
| FR-LNG-02 | Receiver languages: approved templates, voice assets, native review | Partial | `whatsapp.provider.ts:72-80` (SID per lang), `twilio-rendering.ts:35-51` | SMS not localized; voice folders lack ml/ta/bn; `M/data/languages.ts` lacks Malayalam/Tamil; assets/approvals external. |
| FR-LNG-03 | Per-receiver language | Done | schema `Receiver.language`; used in sends | — |
| FR-ADM-01 | Health dashboard: active receivers, cascades, channel error rates, abuse, payment failures | Partial | `operations-visibility.service.ts:73-100`; `M/app/(main)/admin-operations.tsx` | Only check-in status counts/recent; add receiver count, channel error rates, abuse count, billing issues; admin lives inside the mobile app, not web. |
| FR-ADM-02 | Abuse queue: review, pause account, contact sender, close | Partial | `admin-abuse.controller.ts`, `M/app/(main)/admin-abuse-reports.tsx`; specs | No pause-account/contact-sender actions; report content not viewable; no reviewer note. |
| FR-ADM-03 | Human escalation override (Phase 3) | Missing | — | Phase 3. |
| FR-ADM-04 | Read-only support access with audit of every access | Partial | `admin-auth.service.ts:18-30` (SUPPORT_READONLY) | No account lookup tools; admin reads not audit-logged. |
| BRD-6.1 | Shared phone: first response counts, follow-up confirm | Missing | — | — |
| BRD-6.2 | Hospitalised: auto-pause after 5 failed days, notify sender | Missing | one-per-day exists | Add consecutive-failure counter + auto-pause + push. |
| BRD-6.3 | Roaming detection → offer pause | Missing | — | Needs carrier lookup; low priority. |
| BRD-6.4 | Payment failure: 3 retries/7 d, then pause, 14 d suspend | Partial | `billing.service.ts:129-131,146-147`; spec `:105,170` | Grace delegated to stores; no pause-after-grace, no SUSPENDED transition, no sender notice. |
| BRD-6.5 | Account delete → final message to receivers; audit kept 6 y | Partial | `prisma-account.repository.ts:229-289` | No final message; audit retention job absent. |
| BRD-6.6 | WhatsApp outage → SMS automatically; ops alert | Partial | `check-ins.service.ts:203-220` | Only synchronous send failure; no message-status webhook consumption; no ops alerting. |
| BRD-6.7 | Voice AI outage → prerecorded | N/A | Phase 1 is prerecorded already | — |
| BRD-6.8 | Replies accepted in any language (30+); unknown = no response | Missing | `receiver-reply.service.ts:150-165` English only; unknown throws | Keyword catalog per language; treat unknown as no-response (log), never 500. |
| BRD-6.9 | Danger keywords ("dying") flag for attention | Missing | — | — |
| BRD-6.10 | Response-rate decline insight | Missing | — | — |
| BRD-6.11 | WA restricted country → SMS on delivery failure | Partial | same as 6.6 | Consume Twilio message status callbacks. |
| BRD-6.12 | Same receiver under multiple senders → merge/co-monitor prompt | Missing (defect) | `prisma-receivers.repository.ts:293-302` `findFirst` by phoneHash | Replies can be attributed to the wrong sender's receiver; at minimum detect duplicates on create. |
| BRD-7.1 | Monorepo: apps/mobile, apps/admin, apps/backend, packages/*, pnpm+turbo | Partial | repo tree, `package.json` | No `apps/admin`, `shared-utils`, `ui-kit`; npm workspaces, no Turborepo. |
| BRD-7.2 | Mobile stack (Zustand, TanStack Query, NativeWind, RHF+Zod, Maestro) | Partial | `apps/mobile/package.json` | None of those libs; plain hooks/StyleSheet; no E2E. |
| BRD-7.3 | Backend stack (BullMQ/Redis, OpenAPI+SDK, shared Zod) | Partial | `apps/backend/package.json` | No queue, no OpenAPI, Zod only for env (`app-config.service.ts`); request bodies are TS interfaces (`docs/SECURITY.md` §7). |
| BRD-7.4 | Next.js admin panel | Missing | admin screens in mobile app | Decide: keep in-app admin or build web. |
| BRD-7.5 | Twilio for WhatsApp/SMS/voice behind abstraction | Done (unverified live) | `channel-providers.factory.ts`, `configured-channel-providers.spec.ts` | Credentials/sandbox smoke tests pending (README). |
| BRD-7.6 | Stripe + Telr | Missing (superseded) | see FR-BIL-02 | — |
| BRD-7.7 | Hosting (Railway/Fly, Supabase, Upstash, EAS, Vercel) | N/A (ops) | `docs/SECURITY.md` §7 backend not hosted | — |
| BRD-7.8 | Sentry, PostHog, Resend, Crisp, CDN | Missing | grep: none | — |
| BRD-7.9 | pnpm, Turborepo, ESLint, Prettier, husky, tsc CI, Docker | Partial | `.github/workflows/ci.yml`, `scripts/install-hooks.mjs` | ESLint/Prettier/hooks/CI done; no pnpm/turbo/Docker; `format:check` not gated. |
| BRD-8.4 | Repository layer wraps Prisma; controllers never touch Prisma | Done | every module has `*.repository.ts` + `prisma-*.repository.ts` | — |
| BRD-8.5 | `ChannelProvider` interface; cascade knows only the interface | Done | `channel-provider.ts:31-36`, `channel-router.service.ts` | — |
| BRD-8.6 | All external calls via queued jobs; handlers return <200 ms | Missing | `receivers.controller.ts:370`, `step-up.service.ts:40`, `escalations.service.ts` inline sends | Introduce a queue (BullMQ or pg-based) for consent/OTP/escalation sends. |
| BRD-8.7 | No `any`, no console.log, no swallowed errors | Partial | backend clean; `M/services/userData.ts:10-17` uses `any`; `console.*` across mobile; `check-ins.service.ts:161,206` bare `catch` | Mobile cleanup; log swallowed errors. |
| BRD-8.9 | Tests: unit+integration, 70% backend / 50% mobile, <60 s | Partial | `vitest.config.ts:39-44` thresholds 43/42/44/35 | Raise to targets; add repository integration tests against Postgres; Maestro E2E. |
| BRD-8.10 | Perf budgets (API p95 200 ms, cold start 2 s) | Unverified | — | No measurement. |
| BRD-8.11 | Structured business-event logs → PostHog/Sentry | Missing | grep: no Logger usage | Add Nest Logger with structured fields; wire Sentry. |
| BRD-9.2 | Argon2id, 15-min JWT, rotating refresh, login rate limits, step-up | Partial | Supabase-managed; `http-hardening.ts` global throttle 300/min/IP | Per-account/IP login limits & JWT lifetimes are Supabase settings (unverified); step-up Done. |
| BRD-9.3 | Deny-by-default authz; RLS + app checks; admin RBAC | Partial | `prisma/supabase_setup.sql:21-110`, `database.yml`, `admin-auth.service.ts` | RLS read policies + CI invariant Done; no Nest guard (per-controller bearer parsing); DB access is service-role only. |
| BRD-9.4a | AES-256-GCM column encryption of all PII; KMS keys | Partial | `crypto.service.ts`; encrypted: user email/phone, receiver name/phone/note/transcripts, backup name/phone/location, abuse content, admin email | Key from env (`app-config.service.ts:50-53`), no KMS/rotation/`keyVersion`; `resolutionNote`/`reviewNote` never written; caller-ID pool numbers plaintext (operational, OK). |
| BRD-9.4b | Audit log append-only at DB level | Done | `supabase_setup.sql:6-19`; `check-invariants.mjs` | — |
| BRD-9.6 | Templated outbound only; safe reply parsing; libphonenumber; per-sender daily send limits | Partial | `phone-normalizer.ts`, `twilio-rendering.ts` | Daily per-sender limits missing. |
| BRD-9.7 | Per-user/IP API limits; invites 10/day; voice 5/h; captcha; WAF | Partial | `http-hardening.ts:15-27` | Only global IP throttle; no per-user, invite, or voice caps; no captcha; WAF is ops. |
| BRD-9.8 | No card data; webhook signature verify; idempotent charges | Partial | `billing.controller.ts:60-66`, `prisma-billing.repository.ts:27-43` | Webhook token compare not timing-safe; Twilio signatures Done (`provider-webhooks.controller.ts:331-360`). |
| BRD-9.9 | Weekly dependency audit, CVE SLAs, pen test | Done (tooling) | `ci.yml`, `security-weekly.yml`, `codeql.yml` | Pen test/bug bounty are ops. |
| BRD-9.10 | GDPR/PDPL/DPDP, residency, DPAs, DPO | N/A (ops) | deletion/export partial (FR-AUTH-04) | — |
| BRD-9.11 | Incident response, backup restore tests, RPO/RTO | N/A (ops) | — | — |
| BRD-12 | Definition of done (10-min first check-in, 3 profiles live in 3 countries, store approval, docs) | Missing | `README.md` "Current Next Work" | Blocked on hosting, Twilio, RevenueCat, EAS, docs. |
| BRD-13.1.2 | Prisma schema per appendix | Done | `apps/backend/prisma/schema.prisma`; `db:drift-check` | Additive extras (attempts, webhook events, caller-ID, step-up, device tokens, LANDLINE, NEEDS_ATTENTION). |
| BRD-13.1.3a | Extensions, audit triggers, RLS on all user tables, partial indexes | Done | `supabase_setup.sql`, `20260509_*_rls_hardening.sql`, `check-invariants.mjs` | — |
| BRD-13.1.3b | Retention: 30-day hard delete of soft-deleted users; 6-y audit archive; 90-day attempt archive | Partial | `supabase/migrations/20260510181345_*.sql` `archive_operational_logs_before` | Nothing schedules archive/hard delete; add cron + user purge. |
| BRD-13.1.4 | CryptoService single place; hashed lookup; normalize before hash | Done | `crypto.service.ts`, `crypto.service.spec.ts`, `phone-normalizer.ts` | — |
| BRD-13.1.5 | Key mgmt: KMS in prod, rotation plan, `keyVersion` | Partial | `app-config.service.ts:50-64` | Env-only key; no version column. |
| BRD-13.1.6 | Prisma migrations, two-phase destructive changes, staging first | Partial | `prisma/migrations/*`, `database.yml` | Hosted DB has no `_prisma_migrations` (applied by hand) — baseline needed (`docs/SECURITY.md` §7). |

## Built but not in the BRD

- `LANDLINE` tech profile (`schema.prisma`, `M/utils/channelProfiles.ts:14`) — harmless superset of VOICE_ONLY.
- Voice caller-ID pool + sticky assignment tables and repository — required by FR-CHN-03a; implemented and tested, but no admin/ops tooling to populate the pool.
- Biometric login toggle (`M/app/(main)/settings/security.tsx`, `M/services/biometric.ts`) and Appearance settings — not requested.
- RevenueCat billing stack (`billing.*`, `M/services/revenueCat*.ts`) replaces the BRD's Stripe/Telr design without a recorded BRD amendment.
- Admin screens inside the sender mobile app (`admin-operations*.tsx`, `admin-abuse-reports.tsx`; `Sidebar.tsx:13-14` shows them to every user) — BRD specifies a separate Next.js admin; at minimum hide the entries for non-admins.
- Legacy shared-types (`packages/shared-types/constants/index.ts` tiers `free/one_way/two_way/pro_family`, `EscalationEvent` shape) — stale, unused by the backend, confusing next to the Prisma enums.
- `escalateOverdueCheckIns` (`check-ins.service.ts:132-167`) — tested (`spec:463,513`) but unreachable; if ever wired it would auto-alert backups without the sender's choice.
- Provider-webhook dedupe index (`202609050001_provider_webhook_events_dedupe_index`) and partitioned archive tables — good ops work beyond the BRD text.
