# Nearby

Cross-border family check-ins for people caring for loved ones abroad.

Nearby is the new product direction for this repository. The sender uses the mobile app and pays. The receiver does not install anything. The backend reaches the receiver through channels they already use: WhatsApp, SMS, or a short voice call.

This is not an emergency service, a surveillance product, or a medical device. Receiver consent, opt-out, auditability, abuse handling, and PII protection are core product requirements.

## Source Of Truth

- Product requirements: `Business Requirements Document.txt`
- Current engineering handoff: `docs/PROJECT_HANDOFF.md`

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
- Do not wire real WhatsApp/SMS/voice vendors until the local fake-provider flow is proven.

## Repository Layout

```text
apps/
  mobile/          Expo / React Native sender app
  backend/         NestJS / Prisma backend
packages/
  shared-types/    Shared TypeScript types and constants
docs/
  PROJECT_HANDOFF.md
  superpowers/
Business Requirements Document.txt
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

1. Local end-to-end test with a valid Supabase test user.
2. Replace remaining old loved-one/check-in mobile UI with BRD receiver dashboard and receiver detail views.
3. Add real channel webhook adapters only after fake local flow is proven.
4. Build backup contacts and escalation cascade after the local check-in loop is proven.

## License

Private - All rights reserved.
