# Admin Operations Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PII-safe admin detail page for operational check-ins.

**Architecture:** Extend the existing operations visibility module with a single admin-protected detail endpoint and a matching Expo Router detail screen. The endpoint selects only operational fields and escalation delivery metadata, never receiver names, phone numbers, notes, transcripts, or message bodies.

**Tech Stack:** NestJS, Prisma, Expo Router, React Native, Vitest, TypeScript.

---

### Task 1: Backend Detail Contract

**Files:**
- Modify: `apps/backend/src/modules/operations/operations-visibility.repository.ts`
- Modify: `apps/backend/src/modules/operations/operations-visibility.service.ts`
- Modify: `apps/backend/src/modules/operations/prisma-operations-visibility.repository.ts`
- Modify: `apps/backend/src/modules/operations/operations.controller.ts`
- Test: `apps/backend/src/modules/operations/operations-visibility.service.spec.ts`
- Test: `apps/backend/src/modules/operations/prisma-operations-visibility.repository.spec.ts`
- Test: `apps/backend/src/modules/operations/operations.controller.spec.ts`

- [ ] Write failing service, repository, and controller tests for `GET /operations/check-ins/:checkInId`.
- [ ] Verify the tests fail because detail methods do not exist.
- [ ] Implement repository `findOperationalCheckInDetail`, service `getCheckInDetail`, and controller route.
- [ ] Verify backend tests pass.

### Task 2: Mobile Detail Route

**Files:**
- Modify: `apps/mobile/src/services/backendApi.ts`
- Modify: `apps/mobile/src/app/(main)/_layout.tsx`
- Modify: `apps/mobile/src/app/(main)/admin-operations.tsx`
- Create: `apps/mobile/src/app/(main)/admin-operations/[checkInId].tsx`
- Modify: `apps/mobile/src/utils/adminOperations.ts`
- Test: `apps/mobile/src/utils/adminOperations.spec.ts`

- [ ] Add the backend detail response type and client function.
- [ ] Link each recent dashboard item to `/admin-operations/:checkInId`.
- [ ] Add a detail screen that renders operational timeline and escalation attempts only.
- [ ] Add formatter tests for escalation result labels.
- [ ] Verify mobile tests and type-check pass.

### Task 3: Smoke, Docs, Commit

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

- [ ] Smoke `/admin-operations` and a detail route in the in-app browser.
- [ ] Confirm visible output excludes names, phone numbers, transcripts, and message content.
- [ ] Update handoff notes.
- [ ] Commit and push to `master`.
