# Nearby

Cross-border family check-ins for people caring for loved ones abroad.

Nearby is the new product direction for this repository. The sender uses the mobile app and pays. The receiver does not install anything. The backend reaches the receiver through channels they already use: WhatsApp, SMS, or a short voice call.

This is not an emergency service, a surveillance product, or a medical device. Receiver consent, opt-out, auditability, abuse handling, and PII protection are core product requirements.

## Source Of Truth

- Product requirements: `Business Requirements Document.txt`
- Current engineering handoff: `PROJECT_HANDOFF.md`

Read both before starting feature work. The handoff is updated after each completed task so a fresh session can resume quickly.

## Product Model

- Sender: paying customer using the Expo mobile app.
- Receiver: person being checked on; never installs an app and must consent before check-ins begin.
- Backup contact: nearby trusted person contacted only after escalation.
- Backend: orchestrates consent, scheduled check-ins, channel routing, cascades, audit logs, abuse reports, billing, and admin workflows.
- Admin team: monitors system health, abuse review, and operational workflows.

## Non-Negotiables

- No check-ins before receiver consent is granted.
- Receiver can opt out unilaterally with `STOP`.
- Abuse reporting must pause the receiver pending review.
- Audit logs are append-only and must not contain raw PII.
- Receiver names, phone numbers, notes, transcripts, and abuse content are encrypted at the application layer.
- Do not market or imply emergency-service capability.
- Twilio is the selected provider for WhatsApp, SMS, and voice. Keep fake-provider mode for local testing.

## Repository Layout

```text
apps/
  mobile/          Expo / React Native sender app
  backend/         NestJS / Prisma backend
packages/
  shared-types/    Shared TypeScript types and constants
docs/
  superpowers/
Business Requirements Document.txt
PROJECT_HANDOFF.md
```

## Current Stack

| Layer | Technology |
| --- | --- |
| Mobile | Expo, React Native, Expo Router |
| Auth | Supabase Auth |
| Backend | NestJS |
| Database | Supabase Postgres |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| Channels | Provider abstraction with fake local providers first |
| Tests | Vitest |
| Language | TypeScript strict mode |

## Implemented Foundation

- Supabase-backed sender auth sync through `POST /auth/sync-user`.
- Encrypted user and receiver persistence.
- Receiver creation through `POST /receivers`.
- Immediate fake-provider consent request after receiver creation.
- Fake inbound receiver replies through `POST /receiver-replies/fake`.
- Consent grant, decline, revoke, opt-out cooldown, and abuse report handling.
- Check-in response ingestion for `RESPONDED_OK` and `RESPONDED_HELP`.
- Scheduled check-in foundation:
  - finds eligible consent-granted receivers
  - respects pause/delete state
  - evaluates schedule windows in receiver-local timezone
  - creates `check_ins`
  - sends via fake channel providers
  - marks check-ins `SENT`
  - updates latest open check-ins from fake inbound replies
  - writes safe audit events

### HTTP hardening

- `helmet()` default security headers on every response (`X-Content-Type-Options: nosniff`, no `X-Powered-By`, HSTS, and friends).
- Global rate limiting through `@nestjs/throttler`: `RATE_LIMIT_MAX_REQUESTS` requests per `RATE_LIMIT_TTL_SECONDS` per client IP (defaults `300` per `60` seconds).
- Throttle exemptions (`@SkipThrottle()`): the provider webhook controller (Twilio signature / shared-secret authenticated, bursty) and `POST /operations/check-ins/run` (cron-secret authenticated). The admin GET routes under `/operations` stay throttled.
- `TRUST_PROXY` must be set when the backend runs behind a load balancer or reverse proxy (`1`, `true`, `loopback`, or a CIDR); otherwise every client shares the proxy's IP for rate limiting.
- CORS allows requests without an `Origin` header (native app), `http://localhost:80xx` / `http://127.0.0.1:80xx` for local development, and any exact origin listed in the comma-separated `CORS_ALLOWED_ORIGINS`. Everything else is rejected.
- Wiring lives in `apps/backend/src/shared/http/http-hardening.ts`; all four variables are documented in `apps/backend/.env.example`.

## Setup

Install dependencies from the repository root:

```powershell
npm install
```

Create local environment files from examples where available:

```powershell
Copy-Item apps/backend/.env.example apps/backend/.env
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

Local `.env` files are ignored by git. Keep Supabase, database, channel-provider, and KMS secrets out of source control.

## Common Commands

Everything CI runs, in the same order (prisma generate, lint, typecheck, prisma validate, build, all tests, workflow/secret/dependency scans):

```powershell
npm run verify
```

Individual root commands: `npm run lint`, `npm run typecheck`, `npm test` (all Vitest projects: backend, mobile, shared-types, scripts), `npm run test:coverage`, `npm run build`, `npm run format`, `npm run security:workflows`, `npm run security:secrets`, `npm run security:deps`, `npm run security:gitleaks` (Docker). Git hooks are installed by `npm install`; see `docs/SECURITY.md` for what each gate checks and what to do when one is red.

Run backend tests:

```powershell
npm.cmd --prefix apps/backend test
```

Type-check backend:

```powershell
npm.cmd --prefix apps/backend run type-check
```

Build backend:

```powershell
npm.cmd --prefix apps/backend run build
```

Validate Prisma schema without a real local database:

```powershell
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'
npm.cmd --prefix apps/backend run prisma:validate
```

Start backend locally:

```powershell
npm.cmd --prefix apps/backend run dev
```

Start the mobile app:

```powershell
npm.cmd --prefix apps/mobile start
```

Start Expo web:

```powershell
npm.cmd --prefix apps/mobile run web
```

Database shape and invariants (needs a throwaway PostgreSQL 16, for example `docker run -d --name nearby-ci-pg -p 56432:5432 -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=ci postgres:16-alpine`; never point these at the hosted project without reading `apps/backend/scripts/db/apply-all.mjs` first):

```powershell
$env:DATABASE_URL='postgresql://ci:ci@localhost:56432/ci'
$env:SHADOW_DATABASE_URL='postgresql://ci:ci@localhost:56432/ci_shadow'
npm.cmd --prefix apps/backend run db:apply-all         # Prisma migrations, then the loose RLS SQL, then supabase/migrations, in documented order
npm.cmd --prefix apps/backend run db:check-invariants  # RLS on every public table, policy coverage, no PUBLIC write grants, partition objects, audit-log immutability
npm.cmd --prefix apps/backend run db:drift-check       # fails when schema.prisma and prisma/migrations disagree (replays migrations into the shadow DB)
```

On plain PostgreSQL the scripts install a small Supabase shim (`auth.uid()`, `extensions` schema, `anon`/`authenticated`/`service_role` roles) because the RLS policies call `auth.uid()`; a real Supabase database is detected and left alone. The `Database` workflow (`.github/workflows/database.yml`) runs these three steps against a fresh `postgres:16-alpine` on every pull request and push to `master`, so a new table without RLS, a dropped or broadened policy, a write grant to `PUBLIC`, or a schema edit without a migration fails CI before it can reach Supabase.

## Local Fake Flow

Keep `CHANNEL_PROVIDER_MODE=fake` while proving the local end-to-end workflow.

After creating a receiver, simulate a consent reply:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/receiver-replies/fake `
  -ContentType 'application/json' `
  -Body '{"fromPhone":"+971501234567","channel":"WHATSAPP","body":"YES","providerMessageId":"local-consent-1"}'
```

After a check-in is sent, simulate a receiver response with `OK`, `1`, `HELP`, or `2` against the same fake endpoint. The latest open check-in for that receiver will be marked `RESPONDED_OK` or `RESPONDED_HELP`.

## Protected Mobile Auth Boundary

The existing mobile auth setup is sensitive. Do not casually rewrite these files:

- `apps/mobile/src/services/supabase.ts`
- `apps/mobile/src/services/auth.ts`
- `apps/mobile/src/contexts/AuthContext.tsx`
- `apps/mobile/src/components/auth/ProtectedRoute.tsx`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/app/auth/callback.tsx`
- `apps/mobile/src/app/auth/reset-password.tsx`
- `apps/mobile/app.json`

Before and after auth-sensitive work, inspect diffs carefully.

## Current Next Work

Work is driven by `docs/COMPLETION_BACKLOG.md` (consolidated audit of 2026-09-05; raw reports in `docs/audits/2026-09-05/`). Finish Phase 0 and Phase 1 there before any new feature.

1. Configure RevenueCat, App Store Connect, and Google Play subscription products for monthly and annual access, then test purchases in development/TestFlight/Play builds.
2. Add Twilio credentials after the account is approved, then run WhatsApp, SMS, and voice sandbox/live smoke tests.
3. Configure production Expo/EAS push credentials before production device push testing.
4. Rotate Supabase access tokens and database passwords that were exposed during earlier setup.

## License

Private - All rights reserved.
