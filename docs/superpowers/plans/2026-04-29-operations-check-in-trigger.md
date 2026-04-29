# Operations Check-In Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected backend operations endpoint to run due check-ins and missed-check-in escalation.

**Architecture:** `OperationsController` validates a service-role bearer token, calls existing `CheckInsService` methods, and returns aggregate counts only. `OperationsModule` wires the controller into the backend app.

**Tech Stack:** NestJS, Vitest, TypeScript, existing `AppConfigService`, existing `CheckInsService`.

---

### Task 1: Operations Controller

**Files:**
- Create: `apps/backend/src/modules/operations/operations.controller.ts`
- Create: `apps/backend/src/modules/operations/operations.controller.spec.ts`
- Create: `apps/backend/src/modules/operations/operations.module.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Write failing controller test**

Assert valid `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` calls `sendDueCheckIns()` then `escalateOverdueCheckIns()` and returns aggregate counts only.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd --prefix apps/backend test -- operations.controller.spec.ts
```

Expected: FAIL because the operations controller does not exist.

- [ ] **Step 3: Implement minimal controller and module**

Add `POST /operations/check-ins/run`, bearer validation, and module wiring.

- [ ] **Step 4: Run GREEN**

```powershell
npm.cmd --prefix apps/backend test -- operations.controller.spec.ts
```

Expected: PASS.

### Task 2: Verification And Handoff

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

- [ ] **Step 1: Run full verification**

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

- [ ] **Step 2: Update handoff**

Document the operations trigger endpoint, security model, verification evidence, and next step for hosted scheduling.

- [ ] **Step 3: Commit and push**

Commit and push directly to `master`.
