# Emulator Acceptance Runbook

How to drive the mobile app on the Android emulator against a local backend in fake-provider mode, to confirm the built flows work end to end (not just in unit tests). Written for the session after sprint 1 of `COMPLETION_BACKLOG.md`.

Nothing here needs Twilio, WhatsApp, or RevenueCat credentials. Real Supabase auth IS used (the app signs in through Supabase and the backend verifies the JWT), so the Supabase URL and anon key from `apps/backend/.env` / `apps/mobile/.env` are required.

## 1. Prerequisites

- Docker Desktop running, Node 22, Android emulator installed (AVD created in Android Studio).
- `npm ci` done at the repo root, `npm run prisma:generate` done (needs any `DATABASE_URL`).
- Local env files exist and are gitignored: `apps/backend/.env`, `apps/mobile/.env`. Never commit them.
- No `EXPO_PUBLIC_*`, `SUPABASE_*` or `DATABASE_URL` variables at the Windows user or machine level. Expo and dotenv never override an existing variable, so a leftover from another project silently wins over the `.env` files (this pointed the app at the Sandoq Kin project on 2026-09-06). Check with PowerShell: `[Environment]::GetEnvironmentVariables('User').Keys | Where-Object { $_ -match 'EXPO|SUPABASE|DATABASE' }`.
- The Pixel_7 AVD is shared with other projects and may resume showing another app; press Home before `npm run android`.
- A Supabase account to sign in with: the founder's test account (credentials given in chat, never written into the repo). Creating a fresh account is impractical: Supabase rejects test-domain addresses and email confirmation is on.

## 2. Throwaway database

```powershell
docker run -d --name nearby-dev-pg -p 56432:5432 -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=ci postgres:16-alpine
$env:DATABASE_URL='postgresql://ci:ci@localhost:56432/ci'
npm.cmd --prefix apps/backend run db:apply-all        # Prisma migrations + RLS SQL + supabase migration (Supabase shim included)
npm.cmd --prefix apps/backend run db:check-invariants # must pass
```

Reset between runs with `docker rm -f nearby-dev-pg` and repeat.

## 3. Backend in fake-provider mode

Set these for the session. Prefer the shell environment over editing `apps/backend/.env` (dotenv does not override shell values, and the file currently carries no `DATABASE_URL` or KMS key); keep the real `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the file. The service-role key is required by the schema but unused, so a placeholder is fine:

```
DATABASE_URL=postgresql://ci:ci@localhost:56432/ci
CHANNEL_PROVIDER_MODE=fake
KMS_MASTER_KEY_BASE64=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
OPERATIONS_CRON_SECRET=cron-secret
PORT=3000
PUBLIC_API_BASE_URL=http://10.0.2.2:3000
```

Run it two ways, because the compiled build could not boot before PR #18:

```powershell
npm.cmd --prefix apps/backend run dev                       # tsx watch (dev loop)
npm.cmd --prefix apps/backend run build; node apps/backend/dist/main.js   # compiled, what hosting will run
```

`10.0.2.2` is the emulator's alias for the host machine's localhost.

## 4. Mobile app on the emulator

`apps/mobile/.env`:

```
EXPO_PUBLIC_SUPABASE_URL=<same as backend>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<same as backend>
EXPO_PUBLIC_BACKEND_URL=http://10.0.2.2:3000
```

Start the emulator from Android Studio (or `emulator -avd <name>`), then:

```powershell
npm.cmd --prefix apps/mobile run android
```

Metro logs go to the terminal; the handoff's older runs used `expo-android*.log` files at the repo root (gitignored). For an unattended run, `CI=1 npx expo start --android --port 8081` avoids the interactive prompts (reloads are then manual: force-stop Expo Go and reopen `exp://<host>:8081`). To drive the UI from a script, `adb shell uiautomator dump` gives every element's text and bounds; see `docs/audits/2026-09-06/emulator-acceptance.md` for the method that worked.

## 5. Driving the flows

Fake providers send nothing. Each send prints one `[fake-provider]` line in the backend terminal (channel, masked phone, template, and the rendered body or voice script), and the last 200 sends can be listed over HTTP, newest first (CB-067). That is how you read a consent request, a check-in body, a backup alert or the step-up OTP without a phone. Inbound receiver replies are simulated with the fake reply route. Both routes exist only in fake mode and require the cron secret:

```powershell
$h = @{ Authorization = 'Bearer cron-secret'; 'Content-Type' = 'application/json' }
# receiver replies YES / HELP / STOP / REPORT (phone = the receiver's E.164 number you entered in the app)
Invoke-RestMethod -Method Post -Uri http://localhost:3000/receiver-replies/fake -Headers $h -Body '{"fromPhone":"+971500000001","channel":"SMS","body":"YES"}'
# run the scheduler tick (what GitHub Actions calls every 10 minutes)
Invoke-RestMethod -Method Post -Uri http://localhost:3000/operations/check-ins/run -Headers $h
# what the fake providers "sent", newest first (add ?limit=N, 1-200, default 50); OTP codes appear in the body text
(Invoke-RestMethod -Uri http://localhost:3000/receiver-replies/fake/outbound -Headers $h).sends | Format-List
```

Body fields: `fromPhone` (E.164), `channel` (`SMS` or `WHATSAPP`), `body` (the reply text), optional `providerMessageId` (set one to test replay handling). Outbound records: `kind` (`message` or `voice_call`), `at`, `channel`, `to`, `templateKey` or `scriptKey`, `language`, `fallback`, `body`. Source: `apps/backend/src/modules/receivers/receiver-replies.controller.ts`.

Scenario list (each maps to a sprint-1 item; expected outcome in brackets):

1. Email sign-up and login; profile shows name/phone (CB-033 is still open: expect the profile form quirks listed in the backlog).
2. Add a receiver with a personal note → the backend terminal (or the outbound route) shows a consent request in plain English containing the note (CB-010).
3. Fake reply `YES` from the receiver → consent granted in the app.
4. Run the scheduler tick → check-in sent (English sentence with the note); dashboard shows it.
5. Fake reply `YES` → check-in resolved OK.
6. Run the tick again for a new day or use a second receiver; do NOT reply; run the tick repeatedly (attempt offsets are hard-coded, see `check-ins.service.ts`) until the cascade exhausts → check-in NEEDS_ATTENTION and one sender notification audit row (CB-005). Push itself will not arrive on the emulator (no FCM config, CB-031); verify via the audit log / DB or the app's receiver detail.
7. Fake reply `HELP` on an open check-in with a backup contact → check-in ESCALATED, backup alert logged in English with the receiver's name (CB-002, CB-010); fake reply `DONE` from the backup number → resolved.
8. Fake reply `REPORT` → receiver paused (no new check-in on the next tick); admin "reviewed safe" → unpaused (CB-007).
9. Fake reply `STOP` between two attempts → remaining attempt SKIPPED, nothing else sent (CB-008).
10. Free text ("thanks"), an unknown number, a short-code sender → 200 and an audit row, no crash (CB-015).
11. Create a receiver with timezone `Dubai` (invalid) → 400; a valid one still gets its check-in on the next tick (CB-004).
12. Step-up (remove receiver / export / delete) → the OTP appears in the backend terminal and the outbound route as a sentence; enter it in the app.

Known-open mobile items to NOT chase (backlog Phase 3): social login (CB-028), push registration and tap handling (CB-030/031), dashboard error state (CB-032), placeholder settings screens (CB-034), siren asset (CB-038).

## 6. Recording results

Last run: `docs/audits/2026-09-06/emulator-acceptance.md` (12/12 scenarios, one backend defect fixed as CB-070, findings CB-071 to CB-078).

Write `docs/audits/<date>/emulator-acceptance.md` with pass/fail per scenario and the backend log lines that prove each outcome; open backlog items for anything that fails, with the next free `CB-` id.
