# Billing — RevenueCat (Apple IAP / Google Play Billing) — feature handoff

Status: Partially built (code complete, no live store products) · Last verified: backend 2026-09-06 (specs); mobile billing screen 2026-05-18 (emulator: opened, purchase controls disabled without SDK keys)
BRD: FR-BIL-01, BRD-6.4, BRD-9.8 (FR-BIL-02 / BRD-7.6 describe Stripe+Telr and do not match what is built) · Open backlog: CB-027, CB-041, CB-061, CB-066

## What it does

- A sender buys monthly or annual access through Apple In-App Purchase on iOS or Google Play Billing on Android. RevenueCat is the entitlement layer on top of those stores; Stripe, Telr, RevenueCat Web Billing and any external checkout link are rejected because Apple guideline 3.1.1 and the Google Play Payments policy require store billing for app-unlocking digital functionality.
- The mobile billing screen shows current entitlement, monthly/annual plans (store `priceString` when a RevenueCat offering loads, static copy otherwise), and a restore-purchases action.
- RevenueCat webhooks project store subscription state into the local `subscriptions` table. Every backend decision reads that local projection, never RevenueCat at request time.
- A sender without entitlement cannot create a receiver (`403` with `code: "PAID_ACCESS_REQUIRED"`), and the check-in scheduler skips that sender's receivers.
- A billing failure does not cut access immediately: `PAST_DUE` stays entitled until the store paid-through date (`currentPeriodEnd`), then stops.

## Where it lives

| Layer   | Paths                                                                                                                                                                                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Backend | `apps/backend/src/modules/billing/` (`billing.controller.ts`, `billing.service.ts`, `billing.repository.ts`, `prisma-billing.repository.ts`, `billing.module.ts`, `billing.tokens.ts`); gates in `apps/backend/src/modules/receivers/receivers.controller.ts:343-350` and `apps/backend/src/modules/check-ins/check-ins.service.ts:110,274-276`; env getters in `apps/backend/src/shared/config/app-config.service.ts:171-178` |
| Mobile  | `apps/mobile/src/app/(main)/settings/billing.tsx`; `apps/mobile/src/services/revenueCat.ts`, `revenueCatPlans.ts`, `backendErrors.ts`, `backendApi.ts:345`                                                                                                                                |
| Data    | `subscriptions` (`externalProductId`, `revenueCatAppUserId`, `billingInterval`, `store`, `willRenew`; enums `BillingInterval`, `BillingStore`), `idempotency_keys`; migration `apps/backend/prisma/migrations/202605090001_revenuecat_billing_foundation/migration.sql`                    |
| Tests   | `apps/backend/src/modules/billing/{billing.controller,billing.service,prisma-billing.repository}.spec.ts`; gate coverage in `receivers.controller.spec.ts` and `check-ins.service.spec.ts`; `apps/mobile/src/services/{revenueCat,backendErrors,backendApi}.spec.ts`                       |

## Routes and contracts

- `GET /billing/status` — signed-in sender only (Supabase bearer, verified then synced through `UsersService.upsertFromSupabaseIdentity`). Returns `entitled`, `revenueCatAppUserId` (the canonical backend `users.id`), and the latest subscription (tier, status, `billingInterval`, `store`, `currentPeriodEnd`, `willRenew`) or `null`.
- `POST /billing/revenuecat/webhook` — RevenueCat only, no user session. Auth header: `Authorization`, falling back to `x-revenuecat-authorization`; a `Bearer ` prefix is stripped and the remainder compared in constant time (`isMatchingSecret`, `shared/auth/bearer-secret.ts`) to `REVENUECAT_WEBHOOK_AUTH_TOKEN`. Missing token, missing config or mismatch → `401`. Auth is checked first; then a payload missing or mistyping `type`, `id`, `app_user_id`, `product_id`, `transaction_id` (non-empty strings) or `purchased_at_ms` (finite number > 0) → `400` (CB-026). Non-string `entitlement_ids` entries are dropped.
- Webhook idempotency key: `revenuecat:<event.id>`, written to `idempotency_keys` with scope `billing.revenuecat_webhook` and a 90-day `expiresAt`. A `P2002` on that insert means "already processed" and the handler returns `{ processed: false }` without touching subscriptions or audit.
- Paid access is enforced in exactly two backend places, both through `BillingService.getBillingStatus(...).entitled`: `POST /receivers` (before receiver creation and its consent side effects) and `CheckInsService.sendDueCheckIns` (after receiver eligibility, before creating the check-in, its attempts, any provider send, or any check-in audit row; unpaid senders count as `skipped`). No other route is gated.

## How to exercise it locally (fake mode)

- Backend billing needs no RevenueCat account. Bring up the throwaway DB and backend per `docs/EMULATOR_RUNBOOK.md` §2–§3, then add `REVENUECAT_WEBHOOK_AUTH_TOKEN=revenuecat-webhook-token` to `apps/backend/.env`.
- `GET /billing/status` with a sender bearer returns `entitled: false`, `subscription: null`, and the `revenueCatAppUserId` to use everywhere else.
- Grant access by inserting an `ACTIVE` `subscriptions` row with `currentPeriodEnd` in the future — the sprint-1 acceptance run did exactly this: "sender U (ACTIVE subscription, so `hasPaidAccess` passes)" (`docs/audits/2026-09-06/sprint1-acceptance.md`).
- Drive the webhook with `POST /billing/revenuecat/webhook`, `Authorization: Bearer revenuecat-webhook-token`, and a body of `{"event":{...}}` whose `entitlement_ids` contains `nearby_access` and whose `app_user_id` is the backend `users.id`. Re-post the same `event.id` to see `{ "processed": false }`.
- Specs: `npm.cmd --prefix apps/backend test -- src/modules/billing` and `npx.cmd vitest run apps/mobile/src/services/revenueCat.spec.ts`.
- Mobile: the billing screen opens and loads backend status, but purchase and restore stay disabled with the notice `RevenueCat public API key is not configured for this platform.` until `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` are set. Expo Go cannot run a real purchase at all — `react-native-purchases` is native and needs a development, TestFlight or Play test build.

## Invariants — do not break

- RevenueCat `appUserID` is the backend `users.id`, not the Supabase auth user id. The mobile screen takes it from `GET /billing/status.revenueCatAppUserId` and falls back to `syncAuthenticatedUser()`; using `AuthContext.user.id` puts subscriptions on the wrong identity.
- `syncRevenueCatEvent` rejects an `app_user_id` with no matching non-deleted user (`findUserBillingProfile`) before recording idempotency or writing anything. Keep that ordering: idempotency is recorded first, then the subscription upsert, then the audit row.
- Entitlement matching is exact: an event whose `entitlement_ids` omits `REVENUECAT_ENTITLEMENT_ID` is ignored with `{ processed: false }`. The id is trimmed and falls back to `nearby_access` when blank, and the mobile side reads `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID` with the same default — the two must agree with the RevenueCat dashboard.
- The subscription upsert is keyed on `subscriptions.externalSubscriptionId` (unique), which holds the RevenueCat `transaction_id`. Changing that key breaks renewal updates into duplicate rows.
- `findLatestSubscriptionForUser` orders by `currentPeriodEnd desc` and one row decides entitlement. `isEntitled` grants access for `ACTIVE`, `TRIALING`, `CANCELED` and `PAST_DUE` while the period end (or `trialEndsAt` for trials) is still in the future; `SUSPENDED` and expired rows are never entitled.
- `BillingService` is an optional constructor dependency in both gates. When it is absent the gate denies (receivers) or skips (scheduler). Never flip that default to allow.
- Billing audit metadata (`billing.revenuecat_subscription_synced`) carries provider, event type, status, tier, interval, store and `willRenew` only. Keep it PII-free.
- No Stripe, Telr, card form, web checkout or "pay on our site" pointer may appear in the mobile app. `BillingStore.STRIPE` exists only as an enum value for inbound RevenueCat data.

## Known gaps

- CB-027 — the app is not store-buildable: `apps/mobile/eas.json` uses `${VAR}` interpolation, declares no `EXPO_PUBLIC_REVENUECAT_*` or `EXPO_PUBLIC_BACKEND_URL` in any profile, has no `versionCode`/`buildNumber`, and points `submit.production.android.serviceAccountKeyPath` at `./google-services.json`; `apps/mobile/app.json` has an empty `extra.eas.projectId` and no billing-related entry in `plugins`.
- CB-041 — the billing screen does not poll `/billing/status` after a purchase, and `revenueCat.ts` re-`configure()`s on user switch instead of using `Purchases.logIn` / `logOut`.
- CB-061 — tier comes from a regex over the product id (`tier_2|plus` → `TIER_2`, `tier_3|premium|family` → `TIER_3`, else `TIER_1`); there are no per-tier receiver/backup limits, and the BRD's three-retries-over-7-days / suspend-after-14-days-unpaid state is not modelled. The store paid-through period is the only grace window and `SUSPENDED` is never written.
- CB-066 — stale billing artefacts remain: `users.stripeCustomerId` / `telrCustomerId` and unused tier constants in `packages/shared-types`.
- Not set up at all: no RevenueCat project or iOS/Android apps, no App Store Connect or Google Play subscription products, no offering mapped to `nearby_access`, no SDK keys, no webhook URL registered against `POST /billing/revenuecat/webhook`, and no real purchase, restore or cancel has ever been executed on a device build.
- Subscription state is projected straight from the webhook payload; there is no RevenueCat API client to re-fetch canonical customer state, and `environment`, `original_transaction_id` and `event_timestamp_ms` are not stored.
- The billing endpoints are schema-drift sensitive: a database missing the RevenueCat columns returns `Internal server error` from `GET /billing/status`, as seen on 2026-05-18 against a Supabase test database that could not be `prisma migrate deploy`-ed (`P3005`) and needed the checked-in DDL applied by hand.

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` §29i (lines 2583–2666, foundation and provider decision), §29j (lines 2667–3036, compliance research, both paid-access gates, `PAST_DUE` grace, webhook idempotency, `appUserID` alignment, entitlement-config normalisation), and the 2026-05-18 emulator QA note (lines 3440–3472).
- PRs: the archive records no PR numbers for the billing slices; they predate the numbered-PR flow that starts at #17. #34 (CB-026 constant-time webhook token comparison, 400 on payload errors).
