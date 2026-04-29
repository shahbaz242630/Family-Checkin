# Missed Check-In Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escalate sent check-ins that receive no reply within 30 minutes.

**Architecture:** `CheckInsService` owns overdue check-in selection and delegates alert delivery to `EscalationsService`. `EscalationsService` reuses its backup-contact alert loop with a missed-check-in template and PII-safe audit metadata.

**Tech Stack:** NestJS, Prisma, Vitest, TypeScript, existing channel router, existing audit service.

---

### Task 1: Missed Escalation Service Behavior

**Files:**
- Modify: `apps/backend/src/modules/escalations/escalations.service.ts`
- Modify: `apps/backend/src/modules/escalations/escalations.service.spec.ts`

- [ ] **Step 1: Write failing test**

Add a test proving `escalateMissedCheckIn` alerts active backup contacts with template `backup_contact_missed_checkin_alert`, marks the check-in escalated on success, and avoids raw PII in audit metadata.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd --prefix apps/backend test -- escalations.service.spec.ts
```

Expected: FAIL because `escalateMissedCheckIn` does not exist.

- [ ] **Step 3: Implement minimal code**

Share the existing backup-contact alert loop and pass reason-specific template/audit metadata for HELP versus missed check-in.

- [ ] **Step 4: Run GREEN**

```powershell
npm.cmd --prefix apps/backend test -- escalations.service.spec.ts
```

Expected: PASS.

### Task 2: Overdue Check-In Query

**Files:**
- Modify: `apps/backend/src/modules/check-ins/check-ins.repository.ts`
- Modify: `apps/backend/src/modules/check-ins/prisma-check-ins.repository.ts`
- Modify: `apps/backend/src/modules/check-ins/prisma-check-ins.repository.spec.ts`

- [ ] **Step 1: Write failing Prisma test**

Assert the overdue query selects only `SENT` check-ins with `sentAt <= overdueBefore`, ordered by oldest `sentAt`.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd --prefix apps/backend test -- prisma-check-ins.repository.spec.ts
```

Expected: FAIL because the repository method does not exist.

- [ ] **Step 3: Implement query and interface**

Add `findOverdueSentCheckIns(input: { overdueBefore: Date })`.

- [ ] **Step 4: Run GREEN**

```powershell
npm.cmd --prefix apps/backend test -- prisma-check-ins.repository.spec.ts
```

Expected: PASS.

### Task 3: CheckInsService Orchestration

**Files:**
- Modify: `apps/backend/src/modules/check-ins/check-ins.service.ts`
- Modify: `apps/backend/src/modules/check-ins/check-ins.service.spec.ts`
- Modify: `apps/backend/src/modules/check-ins/check-ins.module.ts`

- [ ] **Step 1: Write failing service test**

Assert `escalateOverdueCheckIns()` uses a 30-minute response window, delegates each overdue check-in to `EscalationsService.escalateMissedCheckIn`, and returns attempted/escalated counts.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd --prefix apps/backend test -- check-ins.service.spec.ts
```

Expected: FAIL because orchestration does not exist.

- [ ] **Step 3: Implement minimal orchestration**

Inject `EscalationsService` and call it for each overdue check-in.

- [ ] **Step 4: Run GREEN**

```powershell
npm.cmd --prefix apps/backend test -- check-ins.service.spec.ts
```

Expected: PASS.

### Task 4: Verification, Handoff, Commit

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

Document the completed missed-check-in escalation slice and next step.

- [ ] **Step 3: Commit and push**

Commit and push directly to `master`.
