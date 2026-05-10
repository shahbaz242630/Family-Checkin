# RevenueCat Billing Foundation Design

## Purpose

Pivot Nearby billing away from Stripe-style direct subscriptions and toward App Store / Google Play compliant in-app subscriptions managed through RevenueCat. The foundation should be safe to ship before store credentials and product IDs exist: structure, tests, entitlement gates, and webhooks are ready; live purchase testing waits for app-store configuration and a development/TestFlight/Play build.

## Compliance Position

Nearby's mobile subscription unlocks app/backend functionality, so iOS must use Apple In-App Purchase and Android must use Google Play Billing. RevenueCat is acceptable because it wraps StoreKit and Google Play Billing rather than bypassing them. RevenueCat is not a special exemption from store rules.

## Scope In

- RevenueCat-backed backend billing module.
- Local subscription/entitlement state synchronized from RevenueCat webhooks.
- Server-side entitlement checks for paid features.
- Monthly and annual product support through RevenueCat offerings/products.
- Mobile billing screen wired to a local RevenueCat service wrapper.
- Backend endpoints for:
  - `GET /billing/status`
  - `POST /billing/revenuecat/webhook`
- Config placeholders for RevenueCat public SDK keys, webhook auth token, entitlement ID, and optional REST API key.
- Handoff/README updates that explain dev-client requirement for purchase testing.

## Scope Out

- Stripe, Telr, or direct card payment checkout.
- Live RevenueCat project setup.
- App Store Connect / Play Console product creation.
- Real purchase testing.
- Web billing.
- App Store Server API or Google Play Developer API direct implementation.

## Architecture

Mobile uses RevenueCat SDK for purchase/restore flows. RevenueCat talks to Apple and Google. Backend does not receive card data, store receipts, or client-asserted subscription status as truth. Backend receives RevenueCat webhooks and stores a local projection in the existing `subscriptions` table.

The backend billing module has:

- `BillingController`: authenticated status endpoint and RevenueCat webhook endpoint.
- `BillingService`: entitlement rules and webhook synchronization.
- `BillingRepository`: Prisma persistence for subscriptions and RevenueCat app user IDs.

The mobile app has:

- `revenueCat.ts`: safe wrapper around `react-native-purchases` with dynamic import/fallback so web and environments without native module do not crash.
- Billing screen: shows current backend entitlement and starts monthly/annual purchase through RevenueCat offerings when configured.

## Data Model

Reuse existing `subscriptions`, with additions:

- `billingInterval`: `MONTHLY` or `ANNUAL`
- `externalProductId`: RevenueCat/store product ID
- `revenueCatAppUserId`: stable RevenueCat app user ID, set to backend sender UUID
- `store`: `APP_STORE`, `PLAY_STORE`, `STRIPE`, `PROMOTIONAL`, or `UNKNOWN`
- `willRenew`: boolean

`paymentProvider` is set to `revenuecat`.

## Entitlement Rules

The RevenueCat entitlement ID is configured, defaulting to `nearby_access`.

Backend considers the sender entitled when the latest local subscription has:

- status `ACTIVE` and `currentPeriodEnd` in the future
- status `TRIALING` and trial/period end in the future
- status `CANCELED` with `currentPeriodEnd` in the future, for cancel-at-period-end access

Backend denies paid access for:

- no subscription
- expired period
- `PAST_DUE`
- `SUSPENDED`
- `CANCELED` after period end

This prevents unpaid users from continuing to receive paid benefits after store/RevenueCat state says access ended.

## RevenueCat Webhook Handling

RevenueCat webhooks authenticate with the configured authorization header value. The backend must reject missing or wrong auth tokens.

Supported events include:

- `INITIAL_PURCHASE`
- `RENEWAL`
- `UNCANCELLATION`
- `PRODUCT_CHANGE`
- `CANCELLATION`
- `EXPIRATION`
- `BILLING_ISSUE`

Webhook metadata used:

- `app_user_id`
- `product_id`
- `entitlement_ids`
- `store`
- `expiration_at_ms`
- `purchased_at_ms`
- `period_type`
- `type`

If the configured entitlement is absent, ignore the event because it does not grant Nearby access.

## Security

- RevenueCat public SDK keys are mobile-safe; secret/webhook auth token stays backend-only.
- Backend never trusts mobile claims for entitlement.
- Webhooks are authenticated before processing.
- Audit logs include only user ID, provider, status, tier, interval, store, and event type.
- No raw receipt, card, Apple account, Google account, or payment method details are stored in audit metadata.

## Done Criteria

- Backend tests cover entitlement rules and RevenueCat webhook sync/rejection.
- Mobile type-check passes with safe RevenueCat wrapper.
- Backend test/type-check/build and Prisma validate pass.
- Handoff explains that live purchase testing requires RevenueCat project setup, App Store/Play products, and a dev/TestFlight/Play build.
