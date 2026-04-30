# Operations Scheduler Design

## Goal

Run the existing protected operations trigger on a hosted schedule so due check-ins and overdue escalations continue without a human manually calling the endpoint.

## Approach

Use GitHub Actions scheduled workflows as the first hosted scheduler. The workflow calls a small backend-owned runner script, and the script calls `POST /operations/check-ins/run` with a dedicated operations cron bearer token.

This keeps scheduling outside the NestJS process, avoids duplicate in-app timers when multiple backend instances are running, and does not bind the MVP to Railway, Fly.io, or another specific hosting provider. It also avoids putting the Supabase service-role key in GitHub Actions for this job.

## Configuration

GitHub repository secrets:

- `OPERATIONS_CHECK_INS_RUN_URL`: full deployed URL for the operations endpoint, for example `https://api.example.com/operations/check-ins/run`.
- `OPERATIONS_CRON_SECRET`: random high-entropy token expected by the operations controller.

Local development can run the same script with those environment variables set.

## Data Flow

1. GitHub Actions runs every 10 minutes or by manual dispatch.
2. The workflow installs dependencies with `npm ci`.
3. The workflow runs `npm --prefix apps/backend run operations:check-ins`.
4. The runner sends a POST request to the configured operations URL.
5. The backend runs `sendDueCheckIns()` and `escalateOverdueCheckIns()`.
6. The workflow logs only the aggregate response from the endpoint.

## Security

- GitHub Actions uses only `OPERATIONS_CRON_SECRET`; it does not need the Supabase service-role key.
- The cron secret is read from GitHub Secrets only.
- The runner does not print secret values.
- The runner reconstructs the aggregate response before logging, so unexpected response details are discarded.
- Failed HTTP responses include status and status text only, not response bodies.
- The operations endpoint already returns aggregate counts only and does not expose receiver IDs, names, phone numbers, provider IDs, transcripts, or message bodies.

## Testing

- Unit tests cover runner configuration validation, bearer-token request construction, successful aggregate response handling, and HTTP failure behavior.
- Existing operations controller tests continue to cover endpoint authorization and PII-safe response shape.
