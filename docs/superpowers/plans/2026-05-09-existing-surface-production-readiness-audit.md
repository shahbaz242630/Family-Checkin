# Existing Surface Production Readiness Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and close gaps in already-built Nearby surfaces so they are wired, tested, database-backed where needed, and structurally ready for production credentials.

**Architecture:** This is an audit-and-fix pass over the existing modular monolith and Expo app. It starts from fresh verification evidence, maps implemented surfaces to actual modules/routes/repositories/schema, fixes only existing-surface gaps, and records final evidence in the handoff.

**Tech Stack:** NestJS, Prisma 7, Supabase Postgres/Auth, Expo React Native, TypeScript strict mode, Vitest, Twilio adapter structure, Expo Push API.

---

### Task 1: Baseline Verification

**Files:**
- Read: `docs/PROJECT_HANDOFF.md`
- Read: `Business Requirements Document.txt`
- Read: `package.json`
- Read: `apps/backend/package.json`
- Read: `apps/mobile/package.json`

- [ ] **Step 1: Capture current git state**

Run:

```powershell
git status --short --branch
```

Expected: command exits `0`. Record dirty files mentally and do not revert unrelated changes.

- [ ] **Step 2: Run backend tests**

Run:

```powershell
npm.cmd --prefix apps/backend test
```

Expected: all backend test files pass. If failures occur, inspect the failing tests before changing code.

- [ ] **Step 3: Run backend type-check**

Run:

```powershell
npm.cmd --prefix apps/backend run type-check
```

Expected: TypeScript exits `0`.

- [ ] **Step 4: Run backend build**

Run:

```powershell
npm.cmd --prefix apps/backend run build
```

Expected: Nest build exits `0`. Remove generated `apps/backend/dist` after verification if it appears in git status.

- [ ] **Step 5: Validate Prisma schema**

Run:

```powershell
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Expected: Prisma schema validates without requiring a real database.

- [ ] **Step 6: Run mobile type-check**

Run:

```powershell
npm.cmd --prefix apps/mobile run type-check
```

Expected: TypeScript exits `0`.

### Task 2: Backend Wiring Audit

**Files:**
- Read: `apps/backend/src/app.module.ts`
- Read: `apps/backend/src/modules/**/**/*.module.ts`
- Read: `apps/backend/src/modules/**/**/*.controller.ts`
- Read: `apps/backend/src/modules/**/**/*.service.ts`
- Read: `apps/backend/src/modules/**/**/*.repository.ts`
- Read: `apps/backend/src/shared/config/app-config.service.ts`
- Read: `apps/backend/.env.example`

- [ ] **Step 1: List backend modules and controllers**

Run:

```powershell
rg -n "class .*Module|class .*Controller|@Controller|imports:|providers:|controllers:" apps/backend/src
```

Expected: implemented modules are visible and traceable from `AppModule`.

- [ ] **Step 2: Check repository/provider token bindings**

Run:

```powershell
rg -n "provide:|useClass|useFactory|@Inject\\(" apps/backend/src/modules apps/backend/src/shared
```

Expected: repository abstractions and channel provider factories have explicit bindings where runtime DI needs them.

- [ ] **Step 3: Check direct Prisma boundary**

Run:

```powershell
rg -n "PrismaService|prisma\\." apps/backend/src/modules apps/backend/src/shared
```

Expected: Prisma access is confined to repository/shared Prisma infrastructure except intentional tests.

- [ ] **Step 4: Fix wiring gaps if found**

Use focused tests first for any missing module import, provider binding, config getter, or controller registration. Then implement the smallest code change.

### Task 3: Database And Migration Audit

**Files:**
- Read: `apps/backend/prisma/schema.prisma`
- Read: `apps/backend/prisma/migrations/**/migration.sql`
- Read: `apps/backend/prisma/supabase_setup.sql`
- Read: `apps/backend/prisma/reset_public_schema_for_nearby.sql`

- [ ] **Step 1: Map implemented persistence models**

Run:

```powershell
rg -n "^model |@@map|@@index|enum " apps/backend/prisma/schema.prisma
```

Expected: implemented surfaces have corresponding Prisma models/enums.

- [ ] **Step 2: Confirm migrations exist for new persistence surfaces**

Run:

```powershell
Get-ChildItem -Recurse apps/backend/prisma/migrations -Filter migration.sql | Select-Object -ExpandProperty FullName
```

Expected: migrations cover current schema additions such as device tokens and landline/tech profile changes.

- [ ] **Step 3: Check RLS/audit setup scripts for implemented tables**

Run:

```powershell
rg -n "ENABLE ROW LEVEL SECURITY|CREATE POLICY|audit_logs_no|prevent_audit|device_tokens|backup_contacts|abuse_reports" apps/backend/prisma
```

Expected: security setup scripts reflect user-facing and internal-table boundaries documented in the handoff.

- [ ] **Step 4: Fix schema/setup drift if found**

For drift between Prisma schema, migrations, and setup SQL, add a migration or setup SQL patch only if it belongs to an already-built surface. Validate with `prisma:validate`.

### Task 4: Channel And Twilio Structural Readiness Audit

**Files:**
- Read: `apps/backend/src/modules/channels/*`
- Read: `apps/backend/src/modules/provider-webhooks/*`
- Read: `apps/backend/src/modules/receivers/receiver-reply.service.ts`
- Read: `apps/backend/.env.example`

- [ ] **Step 1: Inspect channel provider factory and configured adapters**

Run:

```powershell
rg -n "CHANNEL_PROVIDER_MODE|TWILIO_|PUBLIC_API_BASE_URL|sendMessage|makeVoiceCall|isAvailableForNumber|Twilio" apps/backend/src apps/backend/.env.example
```

Expected: fake mode works without credentials; configured mode requires Twilio config and fails clearly when missing.

- [ ] **Step 2: Inspect webhook route coverage**

Run:

```powershell
rg -n "provider-webhooks|twilio|X-Twilio-Signature|CHANNEL_WEBHOOK_SECRET|Digits|SpeechResult|MessageSid" apps/backend/src/modules/provider-webhooks apps/backend/src/modules/channels
```

Expected: inbound SMS, WhatsApp, and voice paths map into the existing reply service.

- [ ] **Step 3: Run focused channel/webhook tests**

Run:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/provider-webhooks/provider-webhooks.controller.spec.ts src/modules/channels/configured-channel-providers.spec.ts src/modules/channels/channel-providers.factory.spec.ts src/modules/channels/channel-router.service.spec.ts
```

Expected: focused tests pass.

- [ ] **Step 4: Fix structural readiness gaps if found**

Add tests for missing config validation, provider routing, or webhook mapping. Do not perform live Twilio calls.

### Task 5: Mobile API Wiring Audit

**Files:**
- Read: `apps/mobile/src/services/backendApi.ts`
- Read: `apps/mobile/src/services/index.ts`
- Read: `apps/mobile/src/app/(main)/**/*.tsx`
- Read: `apps/mobile/src/app/(auth)/**/*.tsx`
- Read: `apps/mobile/src/services/database.types.ts`

- [ ] **Step 1: List mobile backend API methods**

Run:

```powershell
rg -n "export async function|async function|fetch\\(|backendApi|/receivers|/admin|/operations|/device-tokens|/account" apps/mobile/src/services apps/mobile/src/app
```

Expected: mobile methods target implemented backend routes and use Supabase bearer auth through the shared API helper.

- [ ] **Step 2: Compare backend route names with mobile calls**

Run:

```powershell
rg -n "@(Get|Post|Patch|Delete)\\(|@Controller\\(" apps/backend/src/modules
```

Expected: mobile-used routes have backend controllers.

- [ ] **Step 3: Fix route/type mismatches if found**

Add or update focused mobile/backend tests where practical, then run mobile type-check and focused backend tests.

### Task 6: Handoff Update And Final Verification

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`
- Read: `docs/superpowers/specs/2026-05-09-existing-surface-production-readiness-audit-design.md`

- [ ] **Step 1: Update handoff with audit results**

Add a dated section describing:

- verified surfaces
- gaps fixed
- commands run
- remaining blockers, with billing/payment explicitly out of scope
- Twilio credential status: structurally ready, live credential smoke pending account availability

- [ ] **Step 2: Run final focused verification for changed areas**

Run the focused commands related to any code changes made during the audit.

- [ ] **Step 3: Run final full verification**

Run:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
npm.cmd --prefix apps/mobile run type-check
```

Expected: all commands exit `0`, or any failures are reported with exact cause.

- [ ] **Step 4: Remove generated backend build output if needed**

Run:

```powershell
if (Test-Path apps/backend/dist) { Remove-Item -Recurse -Force apps/backend/dist }
git status --short --branch
```

Expected: generated `dist` does not remain in the working tree.
