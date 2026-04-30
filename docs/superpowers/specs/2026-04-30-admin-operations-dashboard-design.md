# Admin Operations Dashboard Design

## Goal

Add a read-only Expo web/admin route for checking operations health through admin bearer auth.

## Route

- `/(main)/admin-operations`
- Uses the existing Supabase session through `backendApi`.
- Calls:
  - `GET /auth/admin/me`
  - `GET /operations/check-ins/summary`

## UI

- Show current admin role.
- Show 24-hour status count tiles.
- Show recent operational check-ins with:
  - status
  - scheduled timestamp
  - sent/responded/resolved timestamps when present
  - escalation attempts and successful escalation count
  - check-in id and receiver id as operational identifiers
- Provide a refresh action.
- Show access-denied/error state when the signed-in user is not an active admin.

## Security boundaries

- Do not expose `OPERATIONS_CRON_SECRET`.
- Do not show names, phone numbers, transcripts, message bodies, encrypted payloads, or provider payloads.
- Do not add mutations in this route.
- Do not change sender flows.

## Non-goals

- No admin provisioning UI.
- No filtering/search yet.
- No destructive actions.
