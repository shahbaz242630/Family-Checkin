# Sprint 3 wave 2 — acceptance

Date: 2026-09-07
Merged: #39 (CB-047, CB-085), #40 (CB-042, CB-084). `master` green at `f65d17b`.
Method: two worktree agents with disjoint file ownership, lead review of each
diff before merge, `npm run verify` locally on the rebased combination and all
eight CI checks on both PRs.

## Baseline and result

| | Before | After |
|---|---|---|
| Spec files | 80 | 87 |
| Tests | 803 | 894 |
| Coverage (lines/statements/functions/branches) | 44.1 / 43.4 / 45.7 / 36.7 | 59.65 / 58.96 / 60.7 / 53.0 |
| Coverage thresholds | 43 / 42 / 44 / 35 | 55 / 54 / 56 / 48 (#42) |

`npm run verify` was run on `cb-042-body-validation` rebased onto `#39` — that
is the same content as the merged `master` — and passed with 87 files / 894
tests.

## Checks

| # | Check | Item | Result |
|---|---|---|---|
| W2-1 | `primaryChannel: 'EMAIL'` on receiver create | CB-042 | 400 `VALIDATION_FAILED`, issue path `primaryChannel`. Was a 500. Driven through the route's own pipe read from Nest metadata, so the test fails if the pipe is ever detached. |
| W2-2 | `fallbackChannels: 'SMS'` (string where an array belongs), create and update | CB-042 | 400 `VALIDATION_FAILED`, issue path `fallbackChannels`. Was a 500. |
| W2-3 | Sixth backup contact | CB-042 | 409 `{ code: "BACKUP_CONTACT_LIMIT_REACHED", limit: "5" }`, nothing written. Was a 500. |
| W2-4 | Compiled build over real HTTP | CB-042 | `npm run build` then `node apps/backend/dist/main.js` in fake mode boots and answers `400 {"code":"VALIDATION_FAILED",...}`. |
| W2-5 | Deprecated alias gone | CB-084 | `grep -rn "upsertFromSupabaseIdentity" apps/` returns nothing; a spec asserts the property is absent. Read-path behaviour unchanged. |
| W2-6 | Twilio 21606 reaches the attempt row | CB-047 | `check_in_attempts.failureReason = 'twilio_21606'` at both `PROVIDER_SEND_FAILED` sites (first attempt and cascade, the latter verified with 21211). A code-less error still reads `provider_send_failed`. |
| W2-7 | Twilio 21606 reaches the logs | CB-047 | Log record carries `failureReason`, `providerErrorCode: 21606`, `errorName: 'TwilioRequestError'`. |
| W2-8 | Every repaired catch logs | CB-047 | Nine catches across `check-ins`, `escalations` and `channel-router`; each spec asserts the record and that a sample phone number and name never appear in it. |
| W2-9 | Request id flows end to end | CB-047 | Middleware id appears in the log line and in the `x-request-id` response header; a non-UUID inbound header is replaced with a fresh id. |
| W2-10 | Dead push token retired with no push sent | CB-085 | `POST /operations/push-receipts/run` returns `{ok:true, checked:4, received:3, deactivated:1, expired:1}` with no check-in traffic; missing or wrong bearer rejects without touching the service. |

## PII review (BRD-8.7)

The logger prints only what a caller passes, and callers pass opaque ids, enum
values, provider error codes and `error.message`. `TwilioRequestError.message`
is built from the HTTP status, the Twilio code and the docs URL only — Twilio's
own message, which quotes the rejected number, is deliberately dropped (#36).
Verified by reading `twilio-request-error.ts` rather than taking the agent
report's word for it.

Residual risk, filed as **CB-086**: the helper prints `error.message` for any
error type, so the guarantee holds because of what the code throws today rather
than because anything enforces it. A redaction pass makes it structural.

The validation pipe returns only an issue path, zod's issue code and a message;
zod does not echo the received value, so a rejected body cannot bounce a phone
number back to the caller or into a log.

## Deliberate looseness (reviewed and accepted)

- **Twilio webhook bodies** are validated permissively (`z.looseObject`). Twilio
  signs the URL plus every posted parameter, so stripping unknown fields would
  start 401-ing real traffic. A spec posts a realistic 20-field Twilio form
  through the pipe and asserts the signature still verifies.
- **RevenueCat** schema checks shape but not requiredness; `parseRevenueCatEvent`
  stays the authority.
- **`POST /receiver-replies/fake`** does not require an E.164 `fromPhone`, so the
  documented `201 invalid_sender` path still exists to be audited.
- **`scheduleFrequency`** stays a bounded string rather than an enum so a legacy
  row remains editable.
- **Typed phone numbers** are validated as "dialable" (the app posts
  `+971 50 123 4567`) and must be valid E.164 once separators are stripped if
  they start with `+`; libphonenumber still has the final say.

## Not done in this wave

- Mobile does not consume the shared schemas yet. They are written to run under
  Hermes (no Node built-ins, no `Intl.supportedValuesOf`) and `zod` is on
  `apps/mobile`, so sprint 4 can adopt them without a rewrite.
- No device run. No mobile code changed in either PR, so there was nothing on
  the phone to re-check; the emulator is CPU-heavy and the founder renders video
  on this machine. Sprint 4's Phase 3 work is the right place for the next
  device pass.
- `OPERATIONS_PUSH_RECEIPTS_RUN_URL` does not exist yet. The workflow step
  no-ops with a notice until it does, and the workflow itself stays disabled
  until the backend is hosted.

## Process notes

- Splitting by file ownership worked: the code merged with zero conflicts. Every
  conflict was documentation — three handoff lines that record the wave's PR
  numbers, which both agents naturally wanted to edit.
- Agent A pushed back on an instruction from the lead (excluding specs from the
  shared-types `tsconfig` would have silently disabled the compile-time enum
  guards in `schema-alignment.spec.ts`) and split the config in two instead.
  The pushback was correct.
- The lead staged two files mid-rebase while they still contained conflict
  markers, having checked the conflict list with a truncated command. Caught on
  a follow-up scan and fixed in its own commit (`c27e6f6`) rather than an
  amend. Grep the whole tree for markers before continuing a rebase.
