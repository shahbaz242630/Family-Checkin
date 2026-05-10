# RevenueCat Billing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a RevenueCat-backed in-app subscription foundation with server-side entitlement projection and monthly/annual purchase support.

**Architecture:** Mobile uses RevenueCat SDK for purchases; backend receives RevenueCat webhooks and stores local subscription state. Backend routes check local DB entitlements instead of trusting client claims.

**Tech Stack:** Expo React Native, RevenueCat `react-native-purchases`, NestJS, Prisma, Supabase Auth, Vitest.

---

### Task 1: Schema And Config

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/202605090001_revenuecat_billing_foundation/migration.sql`
- Modify: `apps/backend/prisma/reset_public_schema_for_nearby.sql`
- Modify: `apps/backend/src/shared/config/app-config.service.ts`
- Modify: `apps/backend/.env.example`

- [ ] Add `BillingInterval` and `BillingStore` enums.
- [ ] Add nullable RevenueCat/store fields to `Subscription`.
- [ ] Add RevenueCat backend config getters.
- [ ] Add env examples for RevenueCat public keys and backend webhook auth token.

### Task 2: Backend Billing Module

**Files:**
- Create: `apps/backend/src/modules/billing/billing.module.ts`
- Create: `apps/backend/src/modules/billing/billing.controller.ts`
- Create: `apps/backend/src/modules/billing/billing.service.ts`
- Create: `apps/backend/src/modules/billing/billing.repository.ts`
- Create: `apps/backend/src/modules/billing/prisma-billing.repository.ts`
- Create: `apps/backend/src/modules/billing/billing.tokens.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] Write failing tests for entitlement rules.
- [ ] Implement status endpoint and entitlement rules.
- [ ] Write failing tests for RevenueCat webhook auth and event mapping.
- [ ] Implement webhook sync and audit events.

### Task 3: Mobile RevenueCat Wrapper And Billing Screen

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `package-lock.json`
- Create: `apps/mobile/src/services/revenueCat.ts`
- Modify: `apps/mobile/src/services/backendApi.ts`
- Modify: `apps/mobile/src/services/index.ts`
- Modify: `apps/mobile/src/app/(main)/settings/billing.tsx`

- [ ] Add `react-native-purchases` dependency.
- [ ] Add a dynamic-import wrapper that no-ops safely on web/unavailable native module.
- [ ] Add backend billing status API method.
- [ ] Wire monthly/annual plan buttons to RevenueCat purchase attempts.
- [ ] Show clear setup-needed state when RevenueCat keys/products are absent.

### Task 4: Verification And Handoff

**Files:**
- Modify: `PROJECT_HANDOFF.md`
- Modify: `docs/PROJECT_HANDOFF.md`
- Modify: `README.md`

- [ ] Run focused backend billing tests.
- [ ] Run backend full tests/type-check/build.
- [ ] Run Prisma validation.
- [ ] Run mobile type-check.
- [ ] Document RevenueCat setup remaining steps and dev-client requirement.
