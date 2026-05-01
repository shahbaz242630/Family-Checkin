# Dashboard and Operations Hardening Design

## Purpose

Solidify surfaces that already exist after the full check-in cascade work. This patch does not add billing, language templates, new provider systems, or new BRD feature areas. It makes the sender dashboard, receiver detail, and admin operations views accurately reflect the cascade states we now store.

## Scope

This slice covers:

- Sender-facing mobile dashboard and receiver detail polish.
- Cleanup or hiding of legacy placeholder routes that still reference old product concepts.
- Clear `NEEDS_ATTENTION` handling on sender-facing receiver detail.
- Admin operations detail hardening so receiver cascade attempts are visibly separate from backup escalation events.
- PII-safe operational error/status display for failed and timed-out provider attempts.
- Handoff documentation updates for the completed cascade implementation and this hardening slice.

This slice does not cover:

- Billing or tier enforcement.
- Account deletion or data export backend endpoints.
- API rate limiting, daily sender limits, or OTP step-up.
- Localized templates or voice script final copy.
- Manual admin override, support tooling, or payment failure tooling.

Those remain separate hardening slices.

## Current Behavior

The backend now exposes cascade attempts in operations detail responses, and mobile understands the `NEEDS_ATTENTION` status. The UI still needs a pass to make these states clear to senders and operators. Some mobile routes still carry old product-era names or placeholder screens, which can confuse manual testing and future development.

Admin operations currently shows check-in details and escalation events, but cascade attempts should be treated as the main check-in delivery timeline. Backup escalations are a separate human/family escalation path and should remain visually separate.

## Design

### Sender Dashboard

The main sender dashboard remains the receiver list. It should use existing backend receiver summary data and format each receiver's latest check-in status in clear operational terms:

- `PENDING`: check-in scheduled.
- `SENT`: waiting for receiver reply.
- `NEEDS_ATTENTION`: receiver did not respond after all attempts.
- `RESPONDED_OK`: receiver is OK.
- `RESPONDED_HELP`: receiver asked for help.
- `ESCALATED`: backup contacts were alerted.
- `RESOLVED`: closed.
- `FAILED`: delivery/escalation failed.
- `SKIPPED`: no backup/contact path was available.

No new backend endpoint is required for this part.

### Receiver Detail

Receiver detail should make the latest check-in state and available sender actions obvious. For `NEEDS_ATTENTION`, the primary action set is:

- Try again later.
- Alert backup contacts.
- Mark resolved.

These actions already exist in backend/mobile wiring. The patch should make the UI state clear and avoid hiding these actions behind generic formatting.

### Legacy Route Cleanup

Mobile still contains placeholder or old-concept routes such as old loved-one/check-in/history screens. The patch should remove these routes from active navigation where possible and keep any remaining compatibility route as a simple redirect only when needed. The goal is to reduce confusion without restructuring the auth boundary or breaking Expo Router.

Protected auth files must not be casually rewritten:

- `apps/mobile/src/services/supabase.ts`
- `apps/mobile/src/services/auth.ts`
- `apps/mobile/src/contexts/AuthContext.tsx`
- `apps/mobile/src/components/auth/ProtectedRoute.tsx`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/app/auth/callback.tsx`
- `apps/mobile/src/app/auth/reset-password.tsx`
- `apps/mobile/app.json`

### Admin Operations Detail

Admin operations detail should show two separate timelines:

1. Receiver cascade attempts:
   - channel
   - attempt status
   - scheduled time
   - sent time
   - completed time
   - provider status
   - failure reason

2. Backup escalation events:
   - attempt number
   - channel
   - started/completed time
   - result
   - sender notified time
   - backup alerted time

The cascade attempt section should come first because it explains why the check-in reached `NEEDS_ATTENTION`, `FAILED`, or later sender action states.

### Admin Operations Summary

The summary should keep its PII-safe status count and recent operational check-in behavior. It should include `NEEDS_ATTENTION` in status ordering and labels, which is already partially wired. The hardening patch should verify the status appears correctly and does not fall into generic formatting in any admin surface.

### Error and Safety Rules

Admin operations may show provider status and failure reason because these are operational fields, not raw PII. It must continue excluding:

- receiver names
- phone numbers
- personal notes
- response transcripts
- provider request/response payloads
- encrypted blobs
- hashes

Sender-facing UI can show receiver display name and masked phone through existing receiver APIs, but it should not show transcripts or provider payloads.

## Testing

Backend tests should cover:

- Operations detail response includes cascade attempts and escalations separately.
- Operations response sanitization does not expose unexpected raw fields.
- `NEEDS_ATTENTION` remains in operational status queries.

Mobile tests/type checks should cover:

- Status label/order helpers for `NEEDS_ATTENTION`.
- Admin operations detail rendering can consume `attempts`.
- Mobile type-check passes after route/navigation cleanup.

Manual smoke target:

- Sender receiver detail for a `NEEDS_ATTENTION` check-in shows all three sender actions.
- Admin operations detail shows cascade attempt timeline without names, phone numbers, transcripts, or message bodies.

## Rollout

This is a UI/API hardening patch over existing data and endpoints. It does not require a database migration. It should be safe to ship behind the current app routes after tests pass.

