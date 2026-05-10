# Existing Surface Production Readiness Audit Design

## Purpose

Verify that already-built Nearby functionality is fully implemented, wired together, backed by the database where required, covered by tests, and structurally ready for production integration. This pass is not for adding new product features.

## Scope In

- Backend module wiring, dependency injection, repository bindings, and controller registration for implemented modules.
- Prisma schema, migrations, env examples, and database-facing repository paths for implemented behavior.
- Supabase auth sync and sender-scoped API access.
- Receiver create/list/detail/edit/pause/delete lifecycle.
- Mandatory receiver consent, STOP opt-out, REPORT abuse pause, and opt-out cooldown.
- Fake provider local channel flow for WhatsApp, SMS, and voice.
- Twilio provider adapter structure for SMS, WhatsApp, and voice, including config requirements and provider factory selection.
- Provider webhook controllers for Twilio messaging and voice inbound replies.
- Scheduled check-ins, operations trigger, missed-check-in handling, HELP handling, sender escalation actions, and resolution flows.
- Backup contact CRUD, alert delivery path, and DONE/CHECKED/RESOLVED closure handling.
- Sender push notification structure and device-token persistence, without production credential setup.
- Account export/delete OTP step-up foundation.
- Admin auth, operations visibility, and abuse review surfaces.
- Audit log PII safety and append-only assumptions in service/repository paths.
- Mobile API wiring and type safety for implemented sender/admin surfaces.

## Scope Out

- Billing and payment implementation or gating.
- New BRD features not already coded.
- Live Twilio sandbox or production smoke tests.
- Twilio credential setup.
- Production Expo/EAS push credential setup.
- Broad dependency upgrades or audit-force fixes.

## Verification Strategy

Start with fresh baseline commands:

```powershell
git status --short --branch
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
npm.cmd --prefix apps/mobile run type-check
```

Then inspect code wiring directly:

- Confirm implemented Nest modules are imported into `AppModule`.
- Confirm controllers are reachable through registered modules.
- Confirm services use repositories and provider abstractions rather than direct Prisma/provider calls outside expected boundaries.
- Confirm Prisma models and migrations exist for implemented persistence surfaces.
- Confirm `.env.example` contains the required non-secret configuration keys for fake mode, configured Twilio mode, operations cron auth, webhook auth, push delivery, and Supabase/backend runtime.
- Confirm provider mode can run locally without Twilio credentials in fake mode and fails clearly in configured mode when required credentials are missing.
- Confirm mobile `backendApi` methods align with backend routes and response shapes for implemented screens.

## Gap Fix Rules

Fix only gaps where an already-built surface is incomplete, unwired, untested, or inconsistent with the current code contract. Each fix must include focused tests where the behavior is non-trivial. Do not implement billing, live Twilio setup, or new BRD scope during this pass.

## Done Criteria

- Baseline and final verification commands have fresh output.
- Any discovered existing-surface wiring gaps are fixed or explicitly documented as deferred blockers if they require credentials or out-of-scope work.
- Twilio integration is structurally ready for credentials: config keys, adapters, factory path, webhook endpoints, and tests exist.
- `docs/PROJECT_HANDOFF.md` is updated with verified surfaces, fixed gaps, commands run, and remaining blockers.
