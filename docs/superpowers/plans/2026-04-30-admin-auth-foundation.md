# Admin Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend admin authorization for read-only operations endpoints without exposing scheduler secrets to clients.

**Architecture:** Reuse `SupabaseAuthService` for identity verification and add an admin-users repository/service for allowlist authorization against `admin_users`. Keep cron-secret auth local to scheduler mutation endpoints and use admin bearer auth for human read-only operations endpoints.

**Tech Stack:** NestJS, Prisma, Supabase Auth, Vitest, TypeScript.

---

### Task 1: Admin Repository And Auth Service

**Files:**
- Create: `apps/backend/src/modules/auth/admin-users.repository.ts`
- Create: `apps/backend/src/modules/auth/prisma-admin-users.repository.ts`
- Create: `apps/backend/src/modules/auth/admin-auth.service.ts`
- Test: `apps/backend/src/modules/auth/admin-auth.service.spec.ts`
- Test: `apps/backend/src/modules/auth/prisma-admin-users.repository.spec.ts`

- [ ] **Step 1: Write failing service and repository tests**

Cover active admin success, missing admin rejection, inactive admin rejection, disallowed role rejection, and Prisma lookup selecting no encrypted/hash fields.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm.cmd --prefix apps/backend test -- admin-auth.service.spec.ts prisma-admin-users.repository.spec.ts`

- [ ] **Step 3: Implement admin repository and auth service**

Use `SupabaseAuthService.verifyAccessToken`, `adminUser.findFirst`, and return only admin id/authProviderId/role/active.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm.cmd --prefix apps/backend test -- admin-auth.service.spec.ts prisma-admin-users.repository.spec.ts`

### Task 2: Admin Identity Endpoint

**Files:**
- Modify: `apps/backend/src/modules/auth/auth.controller.ts`
- Modify: `apps/backend/src/modules/auth/auth.controller.spec.ts`
- Modify: `apps/backend/src/modules/auth/auth.module.ts`

- [ ] **Step 1: Write failing controller test**

Cover `GET /auth/admin/me`, bearer requirement, and response containing only admin id and role.

- [ ] **Step 2: Run focused controller test and verify RED**

Run: `npm.cmd --prefix apps/backend test -- auth.controller.spec.ts`

- [ ] **Step 3: Implement endpoint and module providers**

Inject `AdminAuthService`, add admin repository provider, and keep existing sender sync behavior unchanged.

- [ ] **Step 4: Run focused controller test and verify GREEN**

Run: `npm.cmd --prefix apps/backend test -- auth.controller.spec.ts`

### Task 3: Protect Operations Summary With Admin Auth

**Files:**
- Modify: `apps/backend/src/modules/operations/operations.controller.ts`
- Modify: `apps/backend/src/modules/operations/operations.controller.spec.ts`
- Modify: `apps/backend/src/modules/operations/operations.module.ts`

- [ ] **Step 1: Write failing operations controller test**

Update summary tests so `GET /operations/check-ins/summary` requires active admin bearer auth, while `POST /operations/check-ins/run` still requires the cron secret.

- [ ] **Step 2: Run focused operations test and verify RED**

Run: `npm.cmd --prefix apps/backend test -- operations.controller.spec.ts`

- [ ] **Step 3: Implement operations admin auth wiring**

Inject `AdminAuthService` into `OperationsController`, call it for summary, and import `AuthModule` into `OperationsModule`.

- [ ] **Step 4: Run focused operations test and verify GREEN**

Run: `npm.cmd --prefix apps/backend test -- operations.controller.spec.ts`

### Task 4: Verification And Handoff

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

- [ ] **Step 1: Run focused auth/operations tests**

Run: `npm.cmd --prefix apps/backend test -- admin-auth.service.spec.ts prisma-admin-users.repository.spec.ts auth.controller.spec.ts operations.controller.spec.ts`

- [ ] **Step 2: Run full backend verification**

Run:
`npm.cmd --prefix apps/backend run type-check`
`npm.cmd --prefix apps/backend test`
`npm.cmd --prefix apps/backend run build`
`$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate`

- [ ] **Step 3: Document endpoint and auth behavior**

Update `docs/PROJECT_HANDOFF.md` with admin auth rules, protected endpoints, and verification results.
