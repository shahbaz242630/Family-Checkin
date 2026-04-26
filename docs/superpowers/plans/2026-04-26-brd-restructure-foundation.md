# BRD Restructure Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the repository with the Nearby BRD monorepo layout without changing the working mobile auth implementation.

**Architecture:** This first slice is a mechanical layout migration. The existing Expo app moves to `apps/mobile`, the existing Supabase folder moves under `apps/backend`, and shared TypeScript moves to `packages/shared-types`. Auth source files are moved with the app but their contents must remain byte-for-byte identical.

**Tech Stack:** npm workspaces for this interim slice, Expo Router mobile app, existing Supabase project files.

---

### Protected Auth Boundary

Do not edit the contents of these files during the folder move:

- `apps/mobile/src/services/supabase.ts`
- `apps/mobile/src/services/auth.ts`
- `apps/mobile/src/contexts/AuthContext.tsx`
- `apps/mobile/src/components/auth/ProtectedRoute.tsx`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/app/auth/callback.tsx`
- `apps/mobile/src/app/auth/reset-password.tsx`
- `apps/mobile/app.json`

After the move, compare SHA-256 hashes against the pre-move hashes captured from `frontend/...`.

### Task 1: Move Existing Packages To BRD Layout

**Files:**
- Move: `frontend/` to `apps/mobile/`
- Move: `backend/` to `apps/backend/`
- Move: `shared/` to `packages/shared-types/`
- Modify: `package.json`

- [ ] Create `apps/` and `packages/`.
- [ ] Move the three existing package folders.
- [ ] Update root workspaces to `apps/*` and `packages/*`.
- [ ] Update root scripts to point to `apps/mobile` and `apps/backend`.
- [ ] Do not change mobile auth file contents.

### Task 2: Preserve Existing Tooling

**Files:**
- Modify: `package.json`
- Review: `package-lock.json`

- [ ] Keep npm workspaces for now to avoid changing package manager and lockfile in the same slice.
- [ ] Leave pnpm/Turborepo migration for the next foundation task.
- [ ] Run a workspace install only if the lockfile needs path updates.

### Task 3: Verify The Move

**Commands:**
- `npm.cmd --prefix apps/mobile run type-check`
- `git status --short`
- `Get-FileHash` on protected auth files

- [ ] Confirm protected auth file hashes match their pre-move values.
- [ ] Run typecheck and record current errors.
- [ ] Report any pre-existing TypeScript errors separately from restructure errors.

### Out Of Scope For This Slice

- Do not delete Supabase tables.
- Do not apply database migrations.
- Do not rewrite auth.
- Do not introduce NestJS, Prisma, BullMQ, Redis, pnpm, or Turborepo yet.
- Do not build new feature screens.
