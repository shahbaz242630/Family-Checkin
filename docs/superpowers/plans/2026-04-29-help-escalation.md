# Help Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trigger backend backup-contact escalation when a receiver responds that they need help.

**Architecture:** Add a focused `EscalationsModule` with service/repository boundaries. Wire `ReceiverReplyService` to call it after a check-in is marked `RESPONDED_HELP`, keeping provider sends behind `ChannelRouterService` and audit logs PII-safe.

**Tech Stack:** NestJS, Prisma, Vitest, TypeScript, existing channel router, existing audit service.

---

### Task 1: Escalation Service Contract And HELP Success Path

**Files:**
- Create: `apps/backend/src/modules/escalations/escalations.repository.ts`
- Create: `apps/backend/src/modules/escalations/escalations.tokens.ts`
- Create: `apps/backend/src/modules/escalations/escalations.service.ts`
- Create: `apps/backend/src/modules/escalations/escalations.service.spec.ts`

- [ ] **Step 1: Write the failing service test**

Create a Vitest spec that builds an in-memory escalation repository, fake SMS provider, `CryptoService`, and in-memory audit service. The test should call `escalateHelpResponse({ receiverId, checkInId, sourceChannel })` and assert:

- backup contacts are alerted in priority order
- SMS template key is `backup_contact_help_alert`
- one `SUCCESS` escalation event is created per successful contact
- the check-in is marked `ESCALATED`
- audit metadata does not include decrypted names or phone numbers

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm.cmd --prefix apps/backend test -- escalations.service.spec.ts
```

Expected: FAIL because the escalation module files do not exist yet.

- [ ] **Step 3: Implement the minimal service and repository interfaces**

Add repository types for active backup contacts, creating escalation events, and marking check-ins escalated. Add `EscalationsService.escalateHelpResponse`.

- [ ] **Step 4: Run test to verify GREEN**

Run:

```powershell
npm.cmd --prefix apps/backend test -- escalations.service.spec.ts
```

Expected: PASS.

### Task 2: Prisma Repository And Nest Module

**Files:**
- Create: `apps/backend/src/modules/escalations/prisma-escalations.repository.ts`
- Create: `apps/backend/src/modules/escalations/escalations.module.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Write failing Prisma repository tests**

Create tests for active backup-contact ordering, escalation event creation, and check-in `ESCALATED` update using the local Prisma repository testing pattern.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm.cmd --prefix apps/backend test -- prisma-escalations.repository.spec.ts
```

Expected: FAIL because the Prisma implementation does not exist.

- [ ] **Step 3: Implement Prisma repository and module wiring**

Query `backupContact.findMany` with `receiverId` and `deletedAt: null`, ordered by `priorityOrder` then `createdAt`. Use `escalationEvent.create` for each attempt and `checkIn.update` to mark `ESCALATED`.

- [ ] **Step 4: Run test to verify GREEN**

Run:

```powershell
npm.cmd --prefix apps/backend test -- prisma-escalations.repository.spec.ts
```

Expected: PASS.

### Task 3: Receiver Reply Integration

**Files:**
- Modify: `apps/backend/src/modules/receivers/receiver-reply.service.ts`
- Modify: `apps/backend/src/modules/receivers/receiver-reply.service.spec.ts`
- Modify: `apps/backend/src/modules/receivers/receivers.module.ts`

- [ ] **Step 1: Write failing receiver reply integration test**

Update the HELP reply spec so `ReceiverReplyService` receives a fake escalation service and asserts `escalateHelpResponse` is called after the check-in is marked `RESPONDED_HELP`.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm.cmd --prefix apps/backend test -- receiver-reply.service.spec.ts
```

Expected: FAIL because `ReceiverReplyService` does not call escalation yet.

- [ ] **Step 3: Implement receiver reply wiring**

Inject `EscalationsService` into `ReceiverReplyService`. In `handleCheckInReply`, after the audit append for help responses, call `escalateHelpResponse`.

- [ ] **Step 4: Run test to verify GREEN**

Run:

```powershell
npm.cmd --prefix apps/backend test -- receiver-reply.service.spec.ts
```

Expected: PASS.

### Task 4: Verification And Handoff

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend run build
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

- [ ] **Step 2: Update handoff**

Record the completed HELP escalation slice, test evidence, and next steps for missed-check-in escalation.

- [ ] **Step 3: Commit and push to master**

Commit the implementation and handoff update, then push `master`.
