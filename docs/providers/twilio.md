# Twilio — console setup, webhooks, voice audio and caller IDs

Last updated: 2026-09-06 (sprint 3, CB-019 / CB-021 / CB-022). Twilio is the only provider for SMS, WhatsApp and
voice (decision 8, 2026-09-06: the Meta Cloud API path was deleted). This page is what the founder follows when
Twilio credentials exist; the WhatsApp template work is in `docs/providers/whatsapp.md`.

No secrets on this page (the repo is public). Every value below is a variable *name* from `apps/backend/.env.example`.

## 1. Environment variables

| Variable                       | What it is                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `CHANNEL_PROVIDER_MODE`        | `fake` (default, nothing leaves the machine) or `configured` (Twilio).                                             |
| `TWILIO_ACCOUNT_SID`           | Console → Account Info. `AC…`.                                                                                     |
| `TWILIO_AUTH_TOKEN`            | Console → Account Info. Signs every webhook Twilio sends us; rotating it breaks in-flight webhooks for a minute.    |
| `TWILIO_SMS_FROM_NUMBER`       | E.164 of the SMS-capable number, `+15550001111`.                                                                   |
| `TWILIO_WHATSAPP_FROM_NUMBER`  | E.164 of the WhatsApp sender (without the `whatsapp:` prefix; the backend adds it).                                |
| `TWILIO_WHATSAPP_CONTENT_SIDS` | JSON object of approved Content SIDs, `docs/providers/whatsapp.md` §4. Malformed JSON fails boot.                  |
| `TWILIO_VOICE_FROM_NUMBER`     | E.164 of the voice-capable number used when the caller-ID pool has nothing for the receiver's country (§5).        |
| `PUBLIC_API_BASE_URL`          | The public HTTPS origin of the API, no path, no trailing slash: `https://api.example.com`. See §2.                 |
| `VOICE_AUDIO_BASE_URL`         | Where the recorded prompts are hosted, §4. `https://cdn.example.com/voice`.                                         |

Every `TWILIO_*` value is optional at boot: in `configured` mode a channel whose values are missing fails at its
first use with `<Channel> provider credentials are not configured`, and `resolveReachablePlan` treats that channel
as unavailable. `PUBLIC_API_BASE_URL` is the one value that must be exactly right before any webhook can work.

## 2. Webhook URLs (what to paste into the Twilio Console)

All routes are `POST`, answer JSON `{ ok, processed }` except the voice Gather action (TwiML), skip the rate limiter
and verify Twilio's `X-Twilio-Signature` (HMAC-SHA1 over the full request URL plus the sorted POST parameters).
The backend rebuilds the URL as `${PUBLIC_API_BASE_URL}` + route path (+ the query string it received), so:

- `PUBLIC_API_BASE_URL` must be the origin Twilio actually requests: same scheme, host and port, no trailing slash.
- A reverse proxy in front of the API must not rewrite the path or the query string.
- Every request without a valid signature is `401` and nothing is processed.

| Where in the Console                                                          | URL to enter                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Phone Numbers → the SMS number → Messaging → "A message comes in" (Webhook, POST) | `${PUBLIC_API_BASE_URL}/provider-webhooks/twilio/messaging`     |
| Messaging → Senders → WhatsApp senders → the sender → "Webhook URL for incoming messages" | `${PUBLIC_API_BASE_URL}/provider-webhooks/twilio/messaging` |
| Messaging → Senders → WhatsApp senders → "Status callback URL"               | leave empty: the backend passes `StatusCallback` on every message it sends. |
| Phone Numbers → the voice number → Voice → "A call comes in"                 | nothing of ours: inbound calls are not handled. Point it at a TwiML Bin that says the number does not take calls, or leave Twilio's default. |

Routes the backend passes to Twilio itself, per request (no console setting, listed so a firewall or proxy can allow them):

| Route                                                  | Set by                                                            | Purpose                                                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `/provider-webhooks/twilio/messaging/status`           | `StatusCallback` on every SMS and WhatsApp send (only when `PUBLIC_API_BASE_URL` is set) | Delivery statuses; `undelivered`/`failed` fail the attempt within seconds (CB-016). |
| `/provider-webhooks/twilio/voice?lang=<xx>`            | The `<Gather action>` inside the call's TwiML                      | The keypress. Answers `200 text/xml` with a spoken thank-you in `<xx>` and hangs up (CB-022).             |
| `/provider-webhooks/twilio/voice/status`               | `StatusCallback` on every call                                     | Call outcome (`no-answer`, `busy`, `failed`, `completed`).                                                |
| `/provider-webhooks/twilio/voice/amd`                  | `AsyncAmdStatusCallback` on every call                             | Answering-machine detection result.                                                                       |

`lang` is one of `en ar es hi ur ml ta bn` (the audio folder of the receiver's language); it is part of the signed
URL, so a proxy that strips query strings breaks every voice signature.

Inbound message handling: `ButtonPayload` (a WhatsApp quick-reply id) wins over `ButtonText` and `Body`; a
`whatsapp:` prefix on `From` selects the WhatsApp channel; a replayed `MessageSid` answers `processed: 0`.

Also in the Console, before the first real send: Messaging → Settings → Geo permissions and Voice → Settings →
Geo permissions must include every country a receiver lives in, or Twilio refuses the send (error 21408 / 13227).

## 3. Failed sends and Twilio error codes (CB-019)

A non-2xx answer from Twilio's REST API throws `TwilioRequestError` (`apps/backend/src/modules/channels/twilio-request-error.ts`)
with `code` (Twilio's error number), `status` (HTTP), `moreInfo` (Twilio's docs URL for the code) and
`failureReason` = `twilio_<code>` (`twilio_21211`), or `twilio_http_<status>` when the body carried no code. Twilio's
`message` is dropped on purpose: it quotes the `To` number. The check-in engine still records a failed send as
`PROVIDER_SEND_FAILED`; writing `failureReason` into `check_in_attempts` and logging it is CB-047 (wave 2).
Delivery failures reported later by the status callback already carry `ErrorCode` into `check_in.attempt_failed`
audit metadata as `providerErrorCode` (CB-016).

## 4. Voice prompts (hosted audio)

Outbound calls play recorded audio, not text-to-speech, so native speakers can review and re-record a prompt
without a deploy (decision 3). The TwiML is `<Gather input="dtmf" numDigits="1" timeout="10">` around `<Play>`,
played twice, then `<Hangup/>`; the keypress goes to the Gather action, which speaks a short thank-you with
`<Say>` (the only text-to-speech in the product) and hangs up.

### 4.1 Layout

```
${VOICE_AUDIO_BASE_URL}/{language}/{scriptKey}.wav
```

- `{language}`: `en ar es hi ur ml ta bn` (`twilio-rendering.ts` `VOICE_AUDIO_LANGUAGES`). A receiver whose
  language is anything else hears the English folder.
- `{scriptKey}`: exactly the keys the code plays (`TWILIO_VOICE_SCRIPT_KEYS`; `twilio-rendering.spec.ts` scans the
  callers so this list cannot drift):

| File                                 | Played to      | When                                                           | What the recording must say (the receiver's language)                                                                                                        |
| ------------------------------------ | -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `consent_request_voice.wav`          | receiver       | `POST /receivers` and consent resend, `VOICE` primary channel  | Nearby calls on behalf of a family member who wants a short daily check-in call. Press 1 to agree, 9 to stop these calls.                                    |
| `checkin_daily_voice.wav`            | receiver       | every check-in attempt, first or retry (there is no `checkin_retry_voice`) | A family member is checking in. Press 1 if you are okay, 2 if you need help, 9 to stop these calls.                                             |
| `receiver_checkins_paused_voice.wav` | receiver       | sender pauses the receiver                                     | Your check-in calls are paused; you will not be called until they are resumed. Press 9 to stop these calls.                                                  |
| `receiver_checkins_ended_voice.wav`  | receiver       | sender removes the receiver, or the receiver pressed 9 (STOP)  | Your check-in calls have ended; you will not be called again.                                                                                                |
| `sender_escalation_siren_voice.wav`  | sender, English only | push could not reach the sender during an escalation     | Nearby: your receiver needs attention; open the app now.                                                                                                     |

The recordings are generic on purpose: names are not spoken (the prompts carry no variables, which is why fake
mode records `variables: {}` for voice) and the same file serves first and retry attempts. Encode as 8 kHz mono
16-bit PCM WAV, which Twilio plays without transcoding; the code appends `.wav`, so keep WAV.

### 4.2 Keypad

| Digit | Meaning              | Handed to `ReceiverReplyService` as |
| ----- | -------------------- | ----------------------------------- |
| 1     | I am okay / I agree  | `YES`                               |
| 2     | I need help          | `HELP` (escalates)                  |
| 9     | Stop these calls     | `STOP` (revokes consent, 7-day cooldown, confirmation call) |
| other | ignored              | nothing; the call still ends with the thank-you |

Mapping lives in `apps/backend/src/modules/provider-webhooks/twilio-voice-input.ts`. REPORT has no digit: an abuse
report needs a human to read it, and voice-only receivers cannot file one today (known gap).

### 4.3 The spoken thank-you (`<Say>`)

`twilio-rendering.ts` `TWILIO_VOICE_REPLY_SAY`: one sentence per language with a Twilio `<Say language>` code and a
Standard-tier voice that supports it. Twilio has no Urdu voice (neither Google nor Amazon Polly), so `ur` is spoken
by the Hindi voice reading the same plain Hindustani sentence written in Devanagari; every other unsupported
language falls back to English. The non-English sentences are machine translations, unreviewed
(`docs/handoffs/message-copy-review.md`). The Google/Polly voices are billed per character by Twilio; the sentence
is ~50 characters.

### 4.4 Verifying the hosting

```
VOICE_AUDIO_BASE_URL=https://cdn.example.com/voice npm --prefix apps/backend run providers:check-voice-audio
npm --prefix apps/backend run providers:check-voice-audio -- --base-url=https://cdn.example.com/voice --languages=en,ar
```

HEAD-requests every `{language}/{scriptKey}.wav` (GET with a one-byte `Range` when the host refuses HEAD), requires
`2xx` and an `audio/*` content type (a CDN that answers `200 text/html` for a missing file would otherwise break
every call), prints one line per file and exits `1` listing what is missing. The sender siren is checked for `en`
only. Twilio fetches the files from its own servers: the URL must be public (no auth, no IP allow-list) and HTTPS.

### 4.5 What waits for decision 3

Which of the eight languages get recorded prompts, by whom, and the native review of the scripts above and of the
`<Say>` sentences. Until then no voice call can complete in `configured` mode (Twilio fails the `<Play>` with a
404). Nothing in the code depends on the final language list: adding or removing a folder is a hosting change only.

## 5. Voice caller IDs (`voice_caller_id_pool`)

Check-in calls try to come from a number local to the receiver's country, and stick to it for that receiver
(`PrismaVoiceCallerIdRepository.resolveForReceiver`: the receiver's existing assignment, else the least-used
`ACTIVE` + `APPROVED` number for the receiver's `countryCode`, else `TWILIO_VOICE_FROM_NUMBER`). The pool has no UI;
seed it:

```
DATABASE_URL=... npm --prefix apps/backend run db:seed-caller-ids -- --numbers=+447700900123,+15551234567:US
DATABASE_URL=... VOICE_CALLER_IDS=+971501234567 npm --prefix apps/backend run db:seed-caller-ids -- --dry-run
DATABASE_URL=... npm --prefix apps/backend run db:seed-caller-ids -- --numbers=+447700900123 --status=DISABLED
```

- Entries are E.164, optionally `:XX` (ISO 3166-1 alpha-2) when the country cannot be derived (`+1` is US and
  Canada; the script asks when unsure).
- Idempotent upsert on `phoneNumber`: re-running updates `countryCode`, `status`, `complianceStatus` and
  `updatedAt`; assignments and `assignedCount` are untouched. `--status=DISABLED` or `COMPLIANCE_BLOCKED` takes a
  number out of rotation without losing its history.
- Every seeded row is `provider = 'twilio'`, `complianceStatus = 'APPROVED'`: only numbers Twilio has verified for
  that country (regulatory bundle approved, voice-capable) belong in the pool. Run it against the hosted database the
  same way the founder runs migrations (the management-API script) or from a machine that can reach the pooler.

## 6. Exercising the routes without Twilio

```js
// node -e "..." — sign a request the way Twilio does
const { createHmac } = require('node:crypto');
const url = 'https://api.example.com/provider-webhooks/twilio/voice?lang=ar';
const params = { CallSid: 'CA1', To: '+971501234567', From: '+15550003333', Digits: '1' };
const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
console.log(createHmac('sha1', process.env.TWILIO_AUTH_TOKEN).update(data).digest('base64'));
```

`POST` that form body to the same URL with `X-Twilio-Signature: <output>`; the answer is `200 text/xml` with an
Arabic `<Say>` and `<Hangup/>`, and the receiver at `To` gets a `YES` recorded (`processed` semantics for the JSON
routes are in `docs/handoffs/channels-and-providers.md`).

## 7. Founder checklist when credentials land

1. Paste `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, the three `TWILIO_*_FROM_NUMBER`s and `PUBLIC_API_BASE_URL`
   into the hosted environment; set `CHANNEL_PROVIDER_MODE=configured`.
2. Console: the two inbound webhook URLs of §2; Geo permissions for every receiver country.
3. WhatsApp: `docs/providers/whatsapp.md` (templates, approval, `TWILIO_WHATSAPP_CONTENT_SIDS`).
4. Voice: host the prompts (§4), `npm run providers:check-voice-audio`, seed caller IDs (§5), set
   `VOICE_AUDIO_BASE_URL`.
5. First real send only after the founder says go (rule 2 in `PROJECT_HANDOFF.md`) and only to the team's own phones.
