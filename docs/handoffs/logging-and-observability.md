# Logging and observability — feature handoff

Status: Built · Last verified: 2026-09-07 (specs)
BRD: BRD-8.7, BRD-8.11 · Open backlog: CB-053 (no dead-man alert on the scheduler), CB-037 (no request/response logging of bodies — deliberately)

## What it does

- Every backend log line is one JSON object on one line: `timestamp` (ISO), `level`, `context` (the Nest logger's class name), `message`, `requestId` when the line was written while handling a request, and whatever structured fields the caller passed. `error` and `fatal` go to stderr, everything else to stdout; `debug` and `verbose` are off by default.
- Each HTTP request gets an id. `requestIdMiddleware` runs first in the chain, echoes the id back in `x-request-id`, and puts it in an `AsyncLocalStorage` store, so every line written anywhere under that request — including inside an awaited provider call — carries it without being threaded through a single function signature.
- Only a **UUID** is accepted from an inbound `x-request-id`; anything else is replaced with a fresh one. A header is caller-controlled, and an id that ends up in every log line must never be able to carry a phone number or a name.
- Every catch block that used to swallow an error now logs it with an `event` key naming the thing that failed, the ids involved, `error` (the message), `errorName` and, for a provider rejection, `providerErrorCode` (Twilio's number, e.g. 21606). Behaviour is unchanged: the tick still continues, the audit row is still written.
- A Twilio rejection of a check-in send is recorded as what it was: `check_in_attempts.failureReason` and the `check_in.attempt_failed` audit row carry `twilio_<code>` instead of the generic `provider_send_failed` (CB-047).

## Where it lives

| Layer   | Paths                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend | `apps/backend/src/shared/logging/` (`json-logger.ts`, `request-id.middleware.ts`, `request-context.ts`, `error-log-fields.ts`, `index.ts`); wired in `apps/backend/src/main.ts`                     |
| Callers | `check-ins.service.ts`, `escalations.service.ts`, `channel-router.service.ts`, `notifications.service.ts` (pre-existing `Logger`), `fake-outbound-recorder.ts`                                      |
| Tests   | `json-logger.spec.ts`, `request-id.middleware.spec.ts`, `error-log-fields.spec.ts`, plus the CB-047 blocks in `check-ins.service.spec.ts`, `escalations.service.spec.ts`, `channel-router.service.spec.ts` |

## How it is wired

`main.ts` only:

```ts
const logger = new JsonLogger();
const app = await NestFactory.create(AppModule, { logger });
app.use(requestIdMiddleware);      // before applyHttpHardening, so every later handler has the id
```

Services keep using the built-in facade — `private readonly logger = new Logger(MyService.name)` — which routes to the `JsonLogger` at run time. Nothing imports a logging dependency; there is none.

A sample line (no PII, wrapped here for reading):

```json
{"timestamp":"2026-09-07T09:15:00.000Z","level":"error","context":"CheckInsService","requestId":"2f1c9b1a-1111-4222-8333-444455556666","message":"Cascade check-in attempt could not be sent","event":"check_in.attempt_failed","checkInId":"9c2…","receiverId":"7a1…","attemptId":"4d8…","attemptNumber":2,"channel":"SMS","failureReason":"twilio_21606","error":"Twilio request failed (HTTP 400, error code 21606, see https://www.twilio.com/docs/errors/21606)","errorName":"TwilioRequestError","providerErrorCode":21606}
```

## How to exercise it locally

- `npm.cmd --prefix apps/backend run build; node apps/backend/dist/main.js` — boot lines are JSON. `curl -i http://localhost:3000/health` and read the `x-request-id` response header; send your own `-H "x-request-id: <a uuid>"` and the same id comes back and appears in that request's lines.
- Send `-H "x-request-id: not-a-uuid"` and a generated UUID comes back instead.
- Provider failures: run the check-in tick in `CHANNEL_PROVIDER_MODE=fake` against a receiver whose provider throws, or read `check-ins.service.spec.ts` "logs every failure it swallows (CB-047)".

## Invariants — do not break

- **No PII in logs, ever.** No phone numbers, no names, no message bodies, no tokens, no request or response bodies. Opaque ids (`checkInId`, `receiverId`, `attemptId`, `userId`), enum values, counts, reasons and numeric provider codes are what a line may carry — the same rule the audit trail follows (BRD-8.7). `TwilioRequestError` deliberately drops Twilio's own `message` because it quotes the rejected number (CB-019); do not re-add it.
- The inbound `x-request-id` is trusted only when it is a UUID. Loosening that regex puts caller-controlled text into every line.
- `timestamp`, `level`, `context` and `requestId` are the logger's own fields; a caller's object cannot overwrite them (`RESERVED_LOG_FIELDS`).
- Log messages and `error` strings are truncated (2000 and 300 characters). One runaway error must not fill the log pipeline.
- Logging never changes control flow. Every added line sits inside a catch block that already had its own recovery; if you remove a log line the behaviour must be identical.
- `apps/backend/vitest.config.ts` sets up `silence-nest-logger.ts` (`Logger.overrideLogger(false)`) so the specs that drive failure paths do not bury the test output. Specs assert on log lines with `vi.spyOn(Logger.prototype, 'error' | 'warn')`, which intercepts before that silence.

## Known gaps

- No log shipping, retention or alerting: nothing is hosted yet, so the lines only exist on stdout (CB-053 covers the missing dead-man alert on the scheduler).
- No access log. Nest's own request logging is not enabled, and no middleware logs method/path/status/duration — worth adding when the backend is hosted.
- Log level is fixed (`fatal`, `error`, `warn`, `log`). There is no `LOG_LEVEL` environment variable yet; `JsonLogger` already takes `levels` and `setLogLevels`, so wiring one is a two-line change in `main.ts` plus `app-config.service.ts`.
- Receipt-driven token deactivations and the JSON log lines are not correlated with an audit row; the audit trail remains the record of record.

## History

- PRs: #39 (CB-047 — `JsonLogger`, request-id middleware, every silent catch in the check-ins, escalations and channels services, and `TwilioRequestError.failureReason` written into `attempt.failureReason` at both `PROVIDER_SEND_FAILED` sites).
