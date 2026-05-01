# Account Data Privacy and Step-Up Design

Date: 2026-05-01

## Scope

This slice closes the BRD gap for backend-owned account data export and account deletion, and creates the reusable OTP step-up foundation required for sensitive actions.

Included actions:

- `EXPORT_DATA`
- `DELETE_ACCOUNT`

Explicitly out of this slice:

- Receiver deletion step-up. It will reuse the same foundation in the next security hardening slice.
- Billing cancellation and payment-provider cleanup. Account deletion will soft-delete local sender-owned data and leave a clear integration point for future billing cleanup.
- Full legal retention jobs. This slice marks records for deletion/anonymization and keeps audit logs append-only.

## Architecture

Add a backend `account` module that owns privacy endpoints and sensitive action verification. Mobile will stop calling legacy Supabase Edge Function hooks for export/delete and call the Nest backend through `backendApi`.

The module has three boundaries:

- `StepUpService`: creates OTP challenges, sends the OTP by SMS, verifies user-submitted codes, and issues a short-lived one-time token for a specific sensitive action.
- `AccountPrivacyService`: exports sender-owned account data and executes account deletion only when given a verified step-up token.
- `AccountPrivacyRepository`: reads/deletes/anonymizes sender-owned records through Prisma.

## Step-Up Behavior

`POST /account/step-up/request`

- Requires sender bearer auth.
- Accepts `{ action: "EXPORT_DATA" | "DELETE_ACCOUNT" }`.
- Generates a 6-digit OTP.
- Stores only a hash of the OTP, the sender id, action, expiry, attempt count, and consumed state.
- Sends the OTP to the sender phone number using the existing channel provider direction, with SMS as the first implementation.
- Returns only `{ ok: true, challengeId, expiresAt }`.

`POST /account/step-up/verify`

- Requires sender bearer auth.
- Accepts `{ challengeId, code }`.
- Allows a small bounded attempt count.
- Verifies the code hash, sender id, action, expiry, and consumed state.
- Returns `{ ok: true, stepUpToken, action, expiresAt }`.
- The token is random, stored hashed, one-time use, and action-scoped.

Sensitive endpoints require `x-nearby-step-up-token`.

## Export Behavior

`GET /account/export`

- Requires sender bearer auth.
- Requires a valid `EXPORT_DATA` step-up token.
- Returns JSON with the sender profile, receivers, backup contacts, check-ins, cascade attempts, escalations, subscriptions, and user-visible audit metadata.
- Decrypts user-readable fields that belong to the sender.
- Excludes lookup hashes, encrypted ciphertext, provider payloads, provider message ids, raw internal secrets, and admin-only review notes.
- Consumes the step-up token after successful authorization so it cannot be reused.

## Delete Behavior

`DELETE /account`

- Requires sender bearer auth.
- Requires a valid `DELETE_ACCOUNT` step-up token.
- Soft-deletes the user by setting `deletedAt`.
- Soft-deletes receivers and backup contacts where supported.
- Anonymizes receiver and backup phone/name encrypted fields with non-identifying replacement values while preserving referential records needed for audit/legal integrity.
- Leaves audit logs append-only and records an `account.deleted` audit event with safe metadata only.
- Returns `{ ok: true, deletedAt }`.

## Mobile Behavior

The Data & Privacy screen changes from legacy Supabase Edge Function calls to a backend-driven flow:

1. User taps Export or Delete.
2. App requests a step-up OTP for that action.
3. App prompts for the OTP.
4. App verifies the OTP and receives a short-lived token.
5. App calls export/delete with the token.

The old `userData.ts` API can remain as a wrapper, but it must call backend endpoints so the screen does not depend on non-existent Edge Functions.

## Error Handling

- Missing bearer auth returns unauthorized.
- Missing/invalid step-up token returns forbidden.
- Expired or consumed challenges fail without revealing whether the code was close.
- Too many bad OTP attempts locks the challenge.
- Export/delete never return raw hashes, ciphertext, provider ids, or secrets.

## Testing

Tests are written before implementation:

- Step-up request stores hashed challenge and sends SMS without leaking the code in responses.
- Step-up verify rejects wrong codes, expired challenges, consumed challenges, and cross-user attempts.
- Export requires a valid `EXPORT_DATA` token and excludes internal sensitive fields.
- Delete requires a valid `DELETE_ACCOUNT` token, soft-deletes/anonymizes sender-owned records, and appends a safe audit event.
- Mobile backend API helpers type-check and preserve the Data & Privacy screen behavior.
