# Admin Auth Foundation Design

## Goal

Add backend admin authorization so read-only operations visibility can be used by authenticated allowlisted admins without exposing `OPERATIONS_CRON_SECRET` to a client.

## Recommended approach

Use Supabase Auth as the identity provider and the existing `admin_users` table as the backend allowlist.

## Behavior

- Admin requests send `Authorization: Bearer <supabase-access-token>`.
- Backend verifies the token with the existing `SupabaseAuthService`.
- Backend looks up `admin_users.authProviderId`.
- Access is granted only when:
  - the admin row exists
  - `active = true`
  - the role is one of the allowed admin roles for that endpoint
- `GET /auth/admin/me` returns the active admin id and role only.
- `GET /operations/check-ins/summary` changes from `OPERATIONS_CRON_SECRET` auth to active admin bearer auth.
- `POST /operations/check-ins/run` remains protected by `OPERATIONS_CRON_SECRET` because it is a scheduler mutation endpoint.

## Roles

All active admin roles may read operations summary in this slice:

- `SUPER_ADMIN`
- `OPERATOR`
- `SUPPORT_READONLY`

Future write/admin actions can narrow role checks when those endpoints are added.

## Security boundaries

- Do not return admin email, encrypted email, or email hash in endpoint responses.
- Do not expose `OPERATIONS_CRON_SECRET` to mobile/web clients.
- Do not create admin users automatically from sender auth.
- Do not mutate `admin_users` in this slice.
- Keep audit/event data PII-safe as before.

## Non-goals

- No admin UI yet.
- No admin invite or provisioning endpoint yet.
- No password or credential handling beyond Supabase bearer verification.
- No changes to sender auth flow.
