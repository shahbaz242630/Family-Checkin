# Full Cascade Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete BRD Phase 1 smart cascade behavior using a dedicated `check_in_attempts` timeline.

**Architecture:** Add a dedicated check-in attempt model for receiver-channel attempts and keep `escalation_events` for backup escalation. Extend `CheckInsService` to create cascade plans, process due attempts, time out sent attempts, mark exhausted cascades as `NEEDS_ATTENTION`, and close attempts on inbound replies. Update sender actions and operations visibility to use the new state and timeline.

**Tech Stack:** NestJS, Prisma 7, Supabase Postgres, Vitest, Expo/React Native TypeScript.

---

### Task 1: Prisma Cascade Attempt Schema

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/202605010001_check_in_attempts/migration.sql`
- Modify: `apps/backend/prisma/supabase_setup.sql`

- [ ] Add `NEEDS_ATTENTION` to `CheckInStatus`.
- [ ] Add enum `CheckInAttemptStatus`.
- [ ] Add model `CheckInAttempt` related to `CheckIn`.
- [ ] Add SQL migration for enum/table/indexes.
- [ ] Run Prisma generate/validate.

### Task 2: Attempt Repository Contract

**Files:**
- Modify: `apps/backend/src/modules/check-ins/check-ins.repository.ts`
- Modify: `apps/backend/src/modules/check-ins/prisma-check-ins.repository.ts`
- Modify: `apps/backend/src/modules/check-ins/prisma-check-ins.repository.spec.ts`

- [ ] Add repository types for attempt records and attempt mutations.
- [ ] Add failing Prisma repository tests for creating attempts, finding due pending attempts, finding timed-out sent attempts, and marking attempts terminal.
- [ ] Implement repository methods.
- [ ] Verify focused repository tests pass.

### Task 3: Cascade Orchestration Service

**Files:**
- Modify: `apps/backend/src/modules/check-ins/check-ins.service.ts`
- Modify: `apps/backend/src/modules/check-ins/check-ins.service.spec.ts`
- Modify: `apps/backend/src/modules/operations/operations.controller.ts`
- Modify: `apps/backend/src/modules/operations/operations.controller.spec.ts`

- [ ] Add tests for WhatsApp/SMS/voice-only plan creation.
- [ ] Add tests for due attempt send success.
- [ ] Add tests for provider failure advancing to next fallback.
- [ ] Add tests for timeout advancing to next fallback.
- [ ] Add tests for final timeout marking `NEEDS_ATTENTION`.
- [ ] Implement cascade attempt processing.
- [ ] Update operations runner aggregate response.
- [ ] Verify focused service/controller tests pass.

### Task 4: Reply And Sender Action Closure

**Files:**
- Modify: `apps/backend/src/modules/receivers/receiver-reply.service.ts`
- Modify: `apps/backend/src/modules/receivers/receiver-reply.service.spec.ts`
- Modify: `apps/backend/src/modules/receivers/receivers.service.ts`
- Modify: `apps/backend/src/modules/receivers/receivers.service.spec.ts`

- [ ] Add tests proving OK/HELP replies mark sent attempts `RESPONDED` and skip future attempts.
- [ ] Add tests proving `try later` creates a delayed retry cascade on the same check-in.
- [ ] Allow `NEEDS_ATTENTION` for alert backup and resolve.
- [ ] Verify focused receiver tests pass.

### Task 5: Operations And Mobile Visibility

**Files:**
- Modify: `apps/backend/src/modules/operations/operations-visibility.repository.ts`
- Modify: `apps/backend/src/modules/operations/operations-visibility.service.ts`
- Modify: `apps/backend/src/modules/operations/prisma-operations-visibility.repository.ts`
- Modify: `apps/backend/src/modules/operations/operations-visibility.service.spec.ts`
- Modify: `apps/backend/src/modules/operations/prisma-operations-visibility.repository.spec.ts`
- Modify: `apps/mobile/src/services/backendApi.ts`
- Modify: `apps/mobile/src/utils/receiverStatus.ts`
- Modify: `apps/mobile/src/utils/receiverStatus.spec.ts`
- Modify: `apps/mobile/src/utils/adminOperations.ts`
- Modify: `apps/mobile/src/utils/adminOperations.spec.ts`

- [ ] Add operation detail attempt records separate from escalation records.
- [ ] Add `NEEDS_ATTENTION` labels for sender and admin views.
- [ ] Verify focused backend/mobile tests pass.

### Task 6: Handoff And Full Verification

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

- [ ] Update handoff with schema, cascade behavior, endpoints, and verification.
- [ ] Run backend full tests.
- [ ] Run backend type-check.
- [ ] Run backend build.
- [ ] Run Prisma validate.
- [ ] Run mobile type-check.
- [ ] Remove generated `apps/backend/dist`.
- [ ] Commit and push.
