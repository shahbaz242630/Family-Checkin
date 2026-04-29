# Operations Check-In Trigger Design

## Goal

Expose a secure backend-only trigger that runs due check-in sends and missed-check-in escalation without introducing scheduler infrastructure yet.

## Scope

This slice adds a protected operations endpoint. It does not add cron scheduling, hosted job configuration, admin UI, or mobile calls.

## Architecture

Add an `OperationsModule` with `OperationsController`. The controller exposes `POST /operations/check-ins/run`, validates `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, calls `CheckInsService.sendDueCheckIns()` followed by `CheckInsService.escalateOverdueCheckIns()`, and returns aggregate counts only.

## Security

The endpoint is internal and must not accept a user access token. It uses the existing `SUPABASE_SERVICE_ROLE_KEY` from `AppConfigService` as the bearer secret. Failed or missing credentials return `UnauthorizedException`.

The response contains no names, phones, receiver IDs, check-in IDs, transcripts, or provider message IDs.

## Testing

Implementation must be test-first:

- Controller test: valid service-role bearer token runs both check-in operations and returns counts.
- Controller test: missing or wrong bearer token throws `UnauthorizedException`.
- Full backend tests, type-check, build, and Prisma validation must pass before commit.
