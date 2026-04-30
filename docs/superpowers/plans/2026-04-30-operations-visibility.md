# Operations Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a protected read-only operations endpoint for recent check-in health.

**Architecture:** Add an operations visibility repository and service behind `OperationsController`. The controller reuses the existing operations bearer-secret guard and returns only aggregates plus PII-safe operational identifiers/timestamps.

**Tech Stack:** NestJS, Prisma, Vitest, TypeScript.

---

### Task 1: Repository Contract And Service

**Files:**
- Create: `apps/backend/src/modules/operations/operations-visibility.repository.ts`
- Create: `apps/backend/src/modules/operations/operations.tokens.ts`
- Create: `apps/backend/src/modules/operations/operations-visibility.service.ts`
- Test: `apps/backend/src/modules/operations/operations-visibility.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Cover that the service requests a 24-hour count window, asks for 25 recent operational rows, returns `ok: true`, serializes dates to ISO strings, and never includes PII-shaped fields.

- [ ] **Step 2: Run focused service test and verify RED**

Run: `npm.cmd --prefix apps/backend test -- operations-visibility.service.spec.ts`

- [ ] **Step 3: Implement minimal repository contract, token, and service**

Define status counts and recent operational rows with only IDs, statuses, timestamps, and escalation counts.

- [ ] **Step 4: Run focused service test and verify GREEN**

Run: `npm.cmd --prefix apps/backend test -- operations-visibility.service.spec.ts`

### Task 2: Prisma Repository

**Files:**
- Create: `apps/backend/src/modules/operations/prisma-operations-visibility.repository.ts`
- Test: `apps/backend/src/modules/operations/prisma-operations-visibility.repository.spec.ts`

- [ ] **Step 1: Write failing repository tests**

Cover that counts exclude soft-deleted receivers, filter by `scheduledAt >= windowStart`, and recent rows filter to operational statuses with newest-first ordering and a limit.

- [ ] **Step 2: Run focused repository test and verify RED**

Run: `npm.cmd --prefix apps/backend test -- prisma-operations-visibility.repository.spec.ts`

- [ ] **Step 3: Implement minimal Prisma repository**

Use `checkIn.groupBy` for counts and `checkIn.findMany` with `_count` on escalations for recent rows.

- [ ] **Step 4: Run focused repository test and verify GREEN**

Run: `npm.cmd --prefix apps/backend test -- prisma-operations-visibility.repository.spec.ts`

### Task 3: Controller And Module Wiring

**Files:**
- Modify: `apps/backend/src/modules/operations/operations.controller.ts`
- Modify: `apps/backend/src/modules/operations/operations.controller.spec.ts`
- Modify: `apps/backend/src/modules/operations/operations.module.ts`

- [ ] **Step 1: Write failing controller test**

Cover `GET /operations/check-ins/summary`, valid/invalid bearer behavior, service invocation, and no PII keys in the response JSON.

- [ ] **Step 2: Run focused controller test and verify RED**

Run: `npm.cmd --prefix apps/backend test -- operations.controller.spec.ts`

- [ ] **Step 3: Implement controller method and module providers**

Inject `OperationsVisibilityService` and register the Prisma repository provider.

- [ ] **Step 4: Run focused controller test and verify GREEN**

Run: `npm.cmd --prefix apps/backend test -- operations.controller.spec.ts`

### Task 4: Verification And Handoff

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

- [ ] **Step 1: Run focused tests**

Run: `npm.cmd --prefix apps/backend test -- operations-visibility.service.spec.ts prisma-operations-visibility.repository.spec.ts operations.controller.spec.ts`

- [ ] **Step 2: Run backend type-check and full tests**

Run:
`npm.cmd --prefix apps/backend run type-check`
`npm.cmd --prefix apps/backend test`

- [ ] **Step 3: Document endpoint and verification**

Update handoff with endpoint, response contract, auth, and verification.
