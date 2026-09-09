# Nearby — Project Handoff

Last updated: 2026-09-09

Lean by design. This file holds what every session needs. Each feature has its own short handoff in `docs/handoffs/`.
The full session history from 2026-04-26 to 2026-09-06 is frozen in `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md`.

## Read order for a new session

1. This file.
2. `docs/COMPLETION_BACKLOG.md` — the prioritised work list (CB-001 onwards). Work it top to bottom.
3. The handoff in `docs/handoffs/` for each feature you are about to touch.
4. `docs/SECURITY.md` — CI gates, security scans, open rotation items.
5. `Business Requirements Document.txt` (BRD v2.1) when a product question comes up.

Open the archive only when a feature handoff's History section points you there.

## Product in one paragraph

Nearby is a cross-border family check-in service. The sender (the paying customer) uses the mobile app to register a receiver (a relative abroad) who never installs anything. Once the receiver consents by replying YES, the backend sends scheduled check-ins over SMS, WhatsApp or a short voice call, escalates to the sender and to backup contacts when the receiver asks for HELP or does not respond, and lets the receiver opt out (STOP) or report abuse (REPORT) at any time. It is not an emergency service, not surveillance and not a medical device. Consent, opt-out, an append-only audit trail and encrypted PII are non-negotiable.

## Team and working agreement

- Two people: the founder (product owner, not a coder) and Claude (engineering). No other team, no budget.
- Nothing new starts until what is already built is production-complete with tests (founder rule, 2026-09-05). The backlog encodes this order.
- Founder decisions still open are listed near the end of `docs/COMPLETION_BACKLOG.md`. Ask when a backlog item depends on one.

## Stack

| Layer     | Technology                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Mobile    | Expo SDK 54, React Native 0.81, Expo Router 6, TypeScript strict                                                            |
| Auth      | Supabase Auth, email and password (social login is broken, CB-028); tokens verified locally against the project JWKS (CB-024) |
| Backend   | NestJS 11 on Node 22, Prisma 7.8 with `@prisma/adapter-pg`, zod-validated env, helmet and throttling                        |
| Database  | Supabase Postgres, RLS on every table, application-layer AES-256-GCM for PII                                                |
| Channels  | Vendor-neutral `ChannelProvider`; Twilio adapters for SMS, WhatsApp and voice; fake providers locally                       |
| Billing   | RevenueCat (Apple IAP and Google Play); no live products yet                                                                |
| Scheduler | GitHub Actions cron calling `POST /operations/check-ins/run`; disabled until the backend is hosted                          |
| Tests, CI | Vitest (root config, four projects); GitHub Actions: Verify, Security scans, Dependency review, CodeQL, Database invariants |

## Repository layout

- `apps/mobile` — sender app. `apps/backend` — API. `packages/shared-types` — a built package: shared enums, types and the zod request-body schemas. The backend imports it as `@nearby/shared-types` (compiled `dist`); mobile imports the source through its `@shared/*` path mapping, so Metro needs no build step.
- `docs/handoffs/` — one file per feature plus `TEMPLATE.md`. `docs/audits/<date>/` — audit and acceptance reports.
- `docs/archive/` — frozen history. `docs/superpowers/` — plans and specs from April and May 2026 (historical).
- `scripts/` — CI helpers (workflow hygiene, secret scan, dependency audit). `.github/workflows/` — CI.

## Running it locally

`CHANNEL_PROVIDER_MODE=fake` is the default for all local work; nothing leaves the machine. `configured` needs Twilio credentials that do not exist yet.

```powershell
npm ci; npm run prisma:generate           # any prisma command needs DATABASE_URL set (a dummy value is fine)
npm run verify                            # everything CI runs; run before every push
npm.cmd --prefix apps/backend run dev     # tsx watch on PORT (3000)
npm run build; node apps/backend/dist/main.js   # compiled, what hosting will run — the ROOT build, see below
npm run android                           # Expo on the Android emulator (AVD Pixel_7 exists)
```

The backend imports `@nearby/shared-types`, which resolves to `packages/shared-types/dist`, and only the root `npm run build` produces it (#40). Building `apps/backend` alone leaves the compiled API unable to boot — that applies to whatever ends up hosting it too.

Env files exist locally and are gitignored: `apps/backend/.env`, `apps/mobile/.env`. Variable names are in `apps/backend/.env.example`. The emulator reaches the host at `http://10.0.2.2:3000`. Step-by-step: `docs/EMULATOR_RUNBOOK.md`.

## Rules that must not be broken

1. Protected auth boundary. The mobile auth files listed in `docs/handoffs/auth-and-accounts.md` are not rewritten without explicit approval.
2. Fake mode until proven. No real vendor traffic until the local end-to-end flow is proven and the founder says go.
3. Backlog order. Top to bottom; new BRD features wait.
4. `master` is protected — by a GitHub **ruleset** (`protect-master`), not classic branch protection, so `gh api repos/.../branches/master/protection` answers 404 and that 404 does **not** mean unprotected; read it with `gh api repos/.../rulesets`. Five checks are required (Verify, Security scans, Dependency review, Analyse, Database invariants); CodeQL, zizmor and GitGuardian run but do not block. `strict_required_status_checks_policy` is on, so a branch must be current with `master` before it can merge — every merge forces the next open PR to rebase and re-run CI. Branch, `npm run verify`, PR, checks green, then `gh pr merge --squash`. Direct pushes are blocked for everyone.
5. Secrets. Never commit `.env*`; never read `Credentials.xlsx` unless asked; no secrets or project refs in docs (the repo is public by decision).
6. No broad `npm audit fix --force`. Dependency changes go through Dependabot PRs or deliberate bumps.
7. Docs stay lean. A feature PR updates that feature's handoff; this file changes only when the stack, the rules or the next-session opener change. Session narrative goes in the PR description or `docs/audits/<date>/`. New feature: copy `docs/handoffs/TEMPLATE.md`.
8. Do not revert unrelated local changes. `Business Requirements Document.txt` and `.claude/` belong to the founder.

## What is built

| Feature                                                                      | Status                                        | Handoff                                          |
| ---------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| Auth, accounts, step-up OTP, data export and deletion                        | Built                                         | `docs/handoffs/auth-and-accounts.md`             |
| Receivers and consent (YES, STOP with cooldown, REPORT pause, soft delete)   | Built                                         | `docs/handoffs/receivers-and-consent.md`         |
| Backup contacts and the DONE loop                                            | Built                                         | `docs/handoffs/backup-contacts.md`               |
| Check-in engine (schedule, cascade, cron trigger, sender actions)            | Built                                         | `docs/handoffs/check-in-engine.md`               |
| Escalations and notifications (HELP, exhaustion, siren push, voice fallback) | Built; push delivery blocked by missing FCM   | `docs/handoffs/escalations-and-notifications.md` |
| Channels and providers (fake and Twilio, webhooks, message catalog)          | Built; English copy only; no live credentials | `docs/handoffs/channels-and-providers.md`        |
| Admin operations and abuse review                                            | Built                                         | `docs/handoffs/admin-operations.md`              |
| Billing (RevenueCat)                                                         | Foundation built; no live products            | `docs/handoffs/billing-revenuecat.md`            |
| Data, security and privacy (schema, encryption, audit, RLS, partitions)      | Built                                         | `docs/handoffs/data-security-and-privacy.md`     |
| Mobile app shell and screens                                                 | Built; Phase 3 polish open                    | `docs/handoffs/mobile-app.md`                    |
| Logging and observability (JSON lines, request id, provider failure reasons) | Built                                         | `docs/handoffs/logging-and-observability.md`     |
| Request validation (zod body schemas shared with mobile, domain error codes) | Built; mobile does not consume them yet       | `docs/handoffs/receivers-and-consent.md`         |
| CI, security gates, tests                                                    | Built                                         | `docs/SECURITY.md`                               |

## Current state (2026-09-09)

- Sprint 1 (PRs #17 to #21), sprint 2 (#25 to #31), sprint 3 (#34 to #40, #42), sprint 4 wave 1 (#43 to #47), wave 2 (#49 to #54) and wave 3 (#55, (#PR)) are merged. Phase 1 is complete except CB-078. Phase 2 is complete in code; CB-022's audio waits on decision 3. Phase 3 is further on again: CB-029, CB-032 to CB-037, CB-038, CB-039 and CB-041 are done. CB-027 is part done (#49): the app is configured for a store build but no build has been run, so its Done-when line is unobserved.
- Sprint 4 wave 3 (2026-09-09, two agents, zero code conflicts): **CB-038** replaced the 0.35 s / 8 kHz siren blip with a generated 10.000 s, 44.1 kHz, 16-bit mono wail (882,044 bytes, peak 0.72 FS) plus `apps/mobile/scripts/generate-escalation-siren.mjs` and 8 asset tests, and **CB-083** added `apps/backend/scripts/providers/create-whatsapp-templates.mjs`, which creates or updates all 112 WhatsApp Content templates and emits `TWILIO_WHATSAPP_CONTENT_SIDS`. Neither has touched a real vendor: the siren is unheard on a device and no request has ever reached Twilio.
- **`master` was red on 2026-09-09 before either PR existed.** Three multer advisories (GHSA-535w-7cp7-47q4, GHSA-qfvm-cv95-jqjf, GHSA-wc9g-mqfw-jrwm) published overnight and turned the required Security scans check red on master and on every open PR. They are allowlisted as unreachable — the API has no multipart or file-upload route — expiring 2026-12-31. A version bump is not available: multer 2.3.0 patches all three, but `@nestjs/platform-express` pins multer to an exact `2.2.0` in every release up to and including 12.0.1. Remove the entries once NestJS depends on multer >= 2.3.0. A green CI badge from yesterday says nothing about today.
- Tests: 99 spec files, 1030 tests across all projects; the compiled build boots in fake and configured mode. Acceptance: `docs/audits/2026-09-07/sprint3-wave2-acceptance.md` and `docs/audits/2026-09-07/sprint4-wave1-acceptance.md`.
- EAS (2026-09-08, #49): project `@shahbaz242630/family-checkin`, id `ddb699e2-f321-4f9e-8c17-64eeefc4cfd3`. `app.json` is now `app.config.js` (founder-approved, still protected). `EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY` are EAS environment variables in all three environments; `EXPO_PUBLIC_BACKEND_URL` is set in `development` only and the RevenueCat keys in none, because nothing is hosted and no products exist. `npm run check:mobile-config` guards the config in CI.
- **The app runs on a device (2026-09-08).** Android development build `8085bafa-fcb0-41b1-bbcb-c5d626456e34` installs, boots, signs in and registers for push. This is the first installable binary the project has produced. Verified in the same run: CB-031 (an active `ExponentPushToken` in `device_tokens`, which requires working FCM), CB-078 and CB-082 — the last two needed **no code change**; they were Expo Go artefacts that the backlog recorded as defects. CB-028 remains untested. Full record: `docs/audits/2026-09-08/sprint4-wave2-acceptance.md`.
- First EAS build attempted 2026-09-08 and failed twice before succeeding at prebuild: `expo-dev-client` was missing (#52), then `escalation-siren.wav` broke the Android resource-name rule (#53, CB-089). Neither was visible from config review; both needed a build to surface. `npx expo prebuild --platform android --no-install --clean` reproduces the whole prebuild phase locally in about a minute and is far cheaper than a cloud build for this class of failure — but it rewrites `apps/mobile/package.json` scripts to `expo run:*` and leaves an `android/` directory, so revert the first and delete the second.
- Firebase / FCM (2026-09-08, #50): project `nearby-family-checkin` under `shahbaz.malik@hotmail.co.uk` (the founder's other Firebase projects are on a different Google account). Android app registered for `com.familycheckin.app`; `google-services.json` is a secret **file** variable `GOOGLE_SERVICES_JSON` on EAS in all three environments and is gitignored locally. iOS push still needs an APNs key on EAS.
- Formatting: the repository is Prettier-clean and `format:check` is the first step of Verify and of `npm run verify` (CB-087). The debt was 34 tracked files.
- Mobile: the vitest project passes (22 files / 194 tests). Sprint 4 wave 1 is verified by tests only — no device pass since 2026-09-06. Owed on a device: cold-start email confirmation, warm-start recovery link, a non-admin's drawer, the siren with the app backgrounded, a sandbox purchase.
- Hosted Supabase database: every migration in the repo through `202609060302_expo_push_tickets` is applied (the founder ran the management-API script on 2026-09-07; verified: `receivers.consentResendCount integer NOT NULL DEFAULT 0`, `expo_push_tickets` with RLS on and no policies). Future migrations go the same way until `_prisma_migrations` is baselined (pattern in `docs/handoffs/data-security-and-privacy.md`).
- Auth: access tokens are verified locally; the hosted project publishes an ES256 JWKS key, so `SUPABASE_JWT_SECRET` is not needed. The service-role key is optional and never read (founder decision 2026-09-06).
- Nothing is hosted. The scheduler workflow is disabled. No Twilio, RevenueCat or FCM credentials are configured. The founder HAS Expo/EAS, Firebase, Google Play and Apple Developer accounts (2026-09-07) — the identifiers are not in the repo yet; `docs/providers/store-and-push-keys.md` says which are public config and which are secrets.
- 11 Dependabot PRs are open, deferred.

## Next session opener

1. On `master`: `git status --short --branch`, `npm ci`, then `npm run verify` and `npm run test:coverage` (`verify` now runs `format:check` first and `check:mobile-config` before the build; it still does not exercise the coverage thresholds CI enforces).

2. **Sprint 4 wave 3 is closed.** Merged: #55 (CB-038 siren, the multer allowlist, the ci.yml sync) and (#PR) (CB-083 WhatsApp template script). Phase 3 now has only these open: CB-028, CB-030 device half, CB-034's Terms/Privacy (decision 9), CB-040.

3. **The obvious next piece of work is CB-028** — social login, the one item the first device run did not answer. **The recorded "needs a Play Store image" blocker is probably false.** `signInWithGoogle` (`apps/mobile/src/services/auth.ts:116`) uses `supabase.auth.signInWithOAuth` plus `WebBrowser.openAuthSessionAsync` — a Chrome Custom Tab web flow, which needs a **browser**, not Play Services or the Play Store. Settle it with one command on the existing `Nearby_Test` AVD before downloading a 1.5 GB image: `adb shell pm list packages | grep -i "chrome\|browser"`. Note that the system WebView is not a browser and does not provide Custom Tabs.

   The code fix is small and now traced end to end: `auth.ts:113` generates a custom `state` into SecureStore and passes it via `queryParams`, but Supabase's PKCE flow manages its own `state`, so ours never round-trips and `supabase.ts:108` rejects the callback on `expectedState !== stateParam`. Drop the custom `state` and its SecureStore expectation; the PKCE `code` exchange already provides the protection. **The identical pattern is in `signInWithApple` (`auth.ts:170`)**, so this is a two-function fix and Apple sign-in is presumably broken the same way, untested because no iOS build has ever been attempted. Both files are on the protected list and need their own narrow approval.

4. **To get back to a running app** — everything below is already in place, nothing needs rebuilding:
   ```
   emulator -avd Nearby_Test -no-snapshot -gpu swiftshader_indirect -no-boot-anim
   adb wait-for-device && adb shell input keyevent 82 && adb shell input swipe 540 1800 540 500 250   # UNLOCK, or nothing will launch
   docker run -d --name nearby-dev-pg -p 56432:5432 -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=ci postgres:16-alpine
   npm --prefix apps/backend run db:apply-all      # DATABASE_URL=postgresql://ci:ci@localhost:56432/ci
   npm --prefix apps/backend run dev               # env vars in docs/EMULATOR_RUNBOOK.md section 3
   adb reverse tcp:8081 tcp:8081 && adb reverse tcp:3000 tcp:3000
   npx expo start --dev-client --clear             # from apps/mobile
   adb install <apk>                               # or rebuild: eas build --profile development --platform android
   ```
   The installed APK is not kept in the repo; re-download it from the build URL or run a new build. The test account is the founder's own email — ask for the password, it is not stored.

5. **Before any store build**: CB-038 (the siren is still a 0.35 s blip), and the Apple Team ID plus an APNs key for iOS, none of which exist. No iOS build has ever been attempted.

6. **Still open and blocking nothing**: decision 3 (voice languages), decision 9 (Terms/Privacy hosting — the founder is working on a domain), the WhatsApp templates or CB-083, and `OPERATIONS_PUSH_RECEIPTS_RUN_URL` when the backend is hosted.

7. Then Dependabot triage (11 PRs). Next free backlog id: **CB-091**.

8. Wave sizing: two or three agents, not four. `protect-master` sets `strict_required_status_checks_policy`, so every extra parallel PR costs another rebase and another full CI run, and every agent updating the same handoffs costs another doc conflict. Consider having agents write handoff changes to a per-agent fragment merged at close.

## Gotchas

- Windows. PowerShell is the primary shell (`npm.cmd`); Git Bash also works. Long paths break `git worktree remove` on directories with `node_modules`; use `Remove-Item -LiteralPath "\\?\<path>" -Recurse -Force`.
- Prettier on Windows counts more than CI does. `prettier --check` reads the working tree, where a file can still be CRLF; `.gitattributes` (`* text=auto eol=lf`) means git stores and CI checks out LF. On 2026-09-08 it flagged 56 files locally and only 34 of them were real: the other 22 differed by line endings alone and were already correct in git. Before reporting a formatting number, compare the rewritten list against `git status` — `prettier --write` touching a file does not mean the commit will contain it.
- `eas` commands. The npm package is `eas-cli` and the binary it provides is `eas`, so `npx eas <cmd>` fails with "could not determine executable to run"; use `npx eas-cli@latest <cmd>`. Nothing in the repo depends on it. Interactive prompts cannot be answered from this harness (stdin is not readable), so pass `--non-interactive` and the flags the prompt would have asked for — `eas init --account <owner> --non-interactive`. `env:list` rejects `--non-interactive`; `env:create` is deprecated in favour of `env:set`. `eas init` also rewrites the app config with its own JSON formatting and adds `extra.router.root`.
- npm 10.9 crashes with "edgesOut" when a root devDependency forces a hoisted `vitest` upgrade. Keep `vitest` and `@vitest/coverage-v8` at 4.1.5 at the root. Never delete `package-lock.json`.
- **`npm overrides` does not work in this workspace** and fails silently, so it is not a tool available for pinning a transitive dependency. Tried on 2026-09-09 to force `multer` to 2.3.0: `npm ls` reported the edge as `overridden` and the installed copy as `invalid`, but `npm install`, `npm install --package-lock-only` and a run with `node_modules/.package-lock.json` deleted all reported "up to date" and changed nothing, and `npm install --dry-run` planned no change. Flat and nested override forms behaved identically, and the lockfile's root entry never gained an `overrides` key. The only remaining lever is deleting `package-lock.json`, which the rule above forbids. Use the audit allowlist instead, or wait for upstream.
- The dependency allowlist lives in **two** places that must agree: `security/dependency-audit-allowlist.json` and the `allow-ghsas` input on the dependency-review step in `.github/workflows/ci.yml`. `scripts/dependency-audit.test.mjs` fails when they drift. Updating only the JSON reddens Verify — it caught exactly that on 2026-09-09.
- Prisma 7. `DATABASE_URL` lives in `apps/backend/prisma.config.ts`. A fresh `npm ci` does not generate the client; CI and `npm run verify` run `prisma:generate` first.
- Supabase. The account has three projects; the Nearby one is whatever `apps/backend/.env` `DATABASE_URL` points at, never chosen by name. The direct `db.<ref>` host is IPv6-only from this network; use the session pooler on port 5432. `supabase db push` and the Supabase MCP do not work (migration drift, 401); apply SQL through node `pg`.
- Emulator. Host is `10.0.2.2`. Expo Go cannot receive remote push. The Pixel_7 AVD is shared with other projects and may resume showing another app. `adb shell input text` works when the right field is focused first (`uiautomator dump` for bounds); earlier "corruption" was taps landing in the wrong field.
- Emulator, hard-won on 2026-09-08. **A locked Android device cannot start an app.** `monkey` and `cmd package resolve-activity` both report "no activities found" while `dumpsys package` shows the MAIN/LAUNCHER filter registered, and `am start` says the activity class "does not exist" — that contradiction means the lockscreen, not a broken install (`ceDataInode=0` in `dumpsys package` corroborates). Unlock first: `adb shell input keyevent 82` then a swipe up. Hours were spent checking dex files, ABIs and split manifests before this.
- Emulator GPU. `Pixel_7` renders a **black screen** on this machine: its log says `Failed to load opengl32sw (The specified module could not be found.)` and GPU passthrough on the host's Intel UHD Graphics does not work. Boot with `-gpu swiftshader_indirect`. `Nearby_Test` (created 2026-09-08 from the same android-36 image) is this project's own AVD and renders correctly; `Pixel_7` is shared with Sandoq Kin and must not be wiped. Software rendering is slow enough that Android may show "System UI isn't responding" — choose Wait.
- The backend logs **events, not requests**: an empty log after a call is not evidence that no call arrived. On 2026-09-08 that silence was misread as "the app never reached the backend"; the `users` and `device_tokens` rows showed both calls had landed. Query the database, or curl the API and watch whether the log grows at all, before reading silence as absence.
- `npx expo prebuild --platform android --no-install --clean` reproduces the whole EAS prebuild phase locally in about a minute and would have caught both 2026-09-08 build failures for no EAS quota. It rewrites `apps/mobile/package.json` scripts to `expo run:*` and leaves an `android/` directory — revert the first, delete the second.
- Environment shadowing. Expo and dotenv never override a variable that already exists in the process environment. A Windows user-level `EXPO_PUBLIC_SUPABASE_URL` from another project silently pointed the app at the wrong Supabase project on 2026-09-06; it was deleted. Keep all `EXPO_PUBLIC_*`, `SUPABASE_*` and `DATABASE_URL` values in the per-project `.env` files only.
- Local `apps/backend/.env` carries no `DATABASE_URL` or KMS key and a placeholder service-role key (unused, CB-025); supply the run-time values through the shell, as the runbook does. The Supabase anon keys in both env files are valid and identical.
- Worktrees. Launch worktree agents only with the shell at the repo root (a nested worktree was created once). The local gitleaks hook is skipped inside linked worktrees. Agents stop when a background verify is running: nudge them to finish. GitHub runs no CI on a PR that conflicts with master: rebase first. Remove finished worktrees with `Remove-Item -LiteralPath "\\?\<path>" -Recurse -Force` then `git worktree prune` (each holds ~800 MB of `node_modules`). Agents sharing one scratchpad overwrite each other's files: tell them to use unique file names. `apps/backend/.env` is gitignored, so a fresh worktree has no `DATABASE_URL` and `npm run verify` dies at `prisma generate`: export a dummy value for the run. Squash-merged branches are not "merged" to `git branch -d`; delete them with `-D` once GitHub shows the PR as MERGED. A fresh worktree also needs `npm ci` before `npm run verify`. Give each agent a per-agent docs fragment rather than letting several edit the same handoff: every conflict in sprint 3 wave 2 and sprint 4 wave 1 was documentation, never code.
- Metro. Start with `--clear` after pulling new code; `CI=1` mode served a stale screen module once. Two "Remove" buttons exist on the receiver detail (backup row and receiver).
- Hooks. Pre-commit formats staged files with Prettier and scans them for secrets; pre-push runs gitleaks via Docker, lint and type-check.
- Timestamps read through node `pg` from `timestamp(3)` columns appear shifted by the local UTC offset; the database stores UTC.

- Tooling under auto mode. The classifier blocks `git filter-branch`, history rewrites bundled with a force-push, `gh pr merge` in every form (2026-09-07: plain `--squash` is now blocked too, so the founder runs `! gh pr merge <n> --squash` from the prompt), multi-file `cat a b`, `for` loops over `git show`, and some `sed -i` edits of `.gitleaks.toml`; single-file reads, `git push --force-with-lease` on a feature branch after a rebase, and the Edit tool all work. Never put backticks inside a double-quoted shell string: bash executes them. `sed -n 'Ap;Bp;Cp'` prints the lines in **file** order, not the order you wrote them — it silently reorders rows when resolving a conflict by line selection; use one `sed` call per line, and count the rows afterwards. Never read a piped command's exit code with `$?` — it reports the last process in the pipe, so `npm run verify | tail` reports success on a failed build (cost a wasted run on 2026-09-07).
- CI gitleaks scans every commit of a PR, so a renamed fixture still fails on the commit that introduced the old name; the value-exact allowlist in `.gitleaks.toml` is the documented fix. GitGuardian (not a required check) flags a bearer fixture next to a UUID; dismiss it in its dashboard.
- After a rebase that changes `package-lock.json`, run `npm ci` in that worktree before `npm run verify`.
- Git Bash rewrites `/sdcard/...` in `adb shell` arguments; prefix with `MSYS_NO_PATHCONV=1`. Expo Go may be missing after an AVD reset (Expo CLI installs it) and can hang on first launch: force-stop and reopen `exp://<host>:8081`. The throwaway database needs a seeded subscription before the receiver form submits (runbook §2).

## Where the history lives

- `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` — every slice from 2026-04-26 to 2026-09-06. Its section index starts at line 5; §0 and §0a near line 789 are the newest entries; §1 to §34 are chronological from 2026-04-27 to 2026-05-18.
- `docs/audits/2026-09-05/` — the four audits that produced the backlog. `docs/audits/2026-09-06/sprint1-acceptance.md` — the sprint-1 acceptance run.
- `docs/superpowers/` — plans and specs from April and May 2026.
- `git log` and PR descriptions — per-change narrative.
