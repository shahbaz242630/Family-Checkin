# Operations Scheduler Plan

## Scope

Wire a hosted scheduler to the existing operations endpoint without changing check-in or escalation business rules.

## Steps

1. Add a tested runner helper for `POST /operations/check-ins/run`.
2. Add a CLI wrapper that reads `OPERATIONS_CHECK_INS_RUN_URL` and `OPERATIONS_CRON_SECRET`.
3. Add an `operations:check-ins` backend package script.
4. Add a GitHub Actions workflow with a 10-minute cron and manual dispatch.
5. Update project handoff with setup requirements and verification results.
6. Verify focused tests, full backend tests, type-check, build, Prisma validation, and git status.

## Out Of Scope

- Real channel-provider implementation.
- Changing cascade timing or escalation rules.
- Deleting smoke data.
- Adding payment or admin-panel behavior.
