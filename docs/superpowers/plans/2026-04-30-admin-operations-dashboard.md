# Admin Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only admin operations dashboard route in the existing Expo app.

**Architecture:** Extend `backendApi` with typed admin endpoints, add small formatting helpers for status labels and timestamps, then create an Expo Router screen under the authenticated main layout. The screen stays read-only and uses the current Supabase session bearer token.

**Tech Stack:** Expo Router, React Native, TypeScript, Vitest.

---

### Task 1: Admin API Client Types

**Files:**
- Modify: `apps/mobile/src/services/backendApi.ts`
- Modify: `apps/mobile/src/services/index.ts`

- [ ] Add `BackendAdminMe`, `BackendOperationsSummary`, and `BackendOperationsRecentCheckIn` types.
- [ ] Add `getAdminMe()` calling `GET /auth/admin/me`.
- [ ] Add `getOperationsCheckInSummary()` calling `GET /operations/check-ins/summary`.
- [ ] Export the new functions and types from `apps/mobile/src/services/index.ts`.

### Task 2: Formatting Helpers

**Files:**
- Create: `apps/mobile/src/utils/adminOperations.ts`
- Test: `apps/mobile/src/utils/adminOperations.spec.ts`

- [ ] Write failing tests for status labels, date fallback formatting, and status count sorting.
- [ ] Run: `npx vitest run apps/mobile/src/utils/adminOperations.spec.ts`
- [ ] Implement helpers.
- [ ] Re-run the focused helper test.

### Task 3: Dashboard Route

**Files:**
- Create: `apps/mobile/src/app/(main)/admin-operations.tsx`
- Modify: `apps/mobile/src/app/(main)/_layout.tsx`

- [ ] Add `admin-operations` to the main stack.
- [ ] Build the route with loading, error/access-denied, empty, and success states.
- [ ] Show admin role, status counts, and recent operational rows.
- [ ] Add a refresh button that reloads both admin identity and operations summary.

### Task 4: Verification And Handoff

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

- [ ] Run: `npx vitest run apps/mobile/src/utils/adminOperations.spec.ts`
- [ ] Run: `npm.cmd --prefix apps/mobile run type-check`
- [ ] Smoke in Expo web/in-app browser with the provisioned admin account.
- [ ] Document the route, security boundaries, and verification.
