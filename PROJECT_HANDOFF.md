# Nearby — Project Handoff

Last updated: 2026-09-06

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

- `apps/mobile` — sender app. `apps/backend` — API. `packages/shared-types` — shared enums and types.
- `docs/handoffs/` — one file per feature plus `TEMPLATE.md`. `docs/audits/<date>/` — audit and acceptance reports.
- `docs/archive/` — frozen history. `docs/superpowers/` — plans and specs from April and May 2026 (historical).
- `scripts/` — CI helpers (workflow hygiene, secret scan, dependency audit). `.github/workflows/` — CI.

## Running it locally

`CHANNEL_PROVIDER_MODE=fake` is the default for all local work; nothing leaves the machine. `configured` needs Twilio credentials that do not exist yet.

```powershell
npm ci; npm run prisma:generate           # any prisma command needs DATABASE_URL set (a dummy value is fine)
npm run verify                            # everything CI runs; run before every push
npm.cmd --prefix apps/backend run dev     # tsx watch on PORT (3000)
npm.cmd --prefix apps/backend run build; node apps/backend/dist/main.js   # compiled, what hosting will run
npm run android                           # Expo on the Android emulator (AVD Pixel_7 exists)
```

Env files exist locally and are gitignored: `apps/backend/.env`, `apps/mobile/.env`. Variable names are in `apps/backend/.env.example`. The emulator reaches the host at `http://10.0.2.2:3000`. Step-by-step: `docs/EMULATOR_RUNBOOK.md`.

## Rules that must not be broken

1. Protected auth boundary. The mobile auth files listed in `docs/handoffs/auth-and-accounts.md` are not rewritten without explicit approval.
2. Fake mode until proven. No real vendor traffic until the local end-to-end flow is proven and the founder says go.
3. Backlog order. Top to bottom; new BRD features wait.
4. `master` is protected. Branch, `npm run verify`, PR, all five checks green, then `gh pr merge --squash --delete-branch`. Direct pushes are blocked for everyone.
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
| CI, security gates, tests                                                    | Built                                         | `docs/SECURITY.md`                               |

## Current state (2026-09-06, late evening)

- Sprint 1 (PRs #17 to #21), sprint 2 (#25 to #31) and sprint 3 wave 1 (#34, #35, #36) are merged. Phase 1 is complete except CB-078 (needs approval to touch a protected auth file). Phase 2 is complete in code (CB-019 to CB-026); CB-022's audio recordings wait on decision 3 and CB-083 (template-creation script) is new. Of the hardening set, CB-045 and CB-048 are done; CB-042 and CB-047 are wave 2. `master` CI is green at `d9e2350`.
- Backend: 80 spec files, 803 tests across all projects; the compiled build boots in fake and configured mode. Acceptance: `docs/audits/2026-09-06/sprint3-acceptance.md` (11 sprint-3 checks plus the escalation loop on the device and the API, all pass, no new findings).
- Mobile: the vitest project passes (14 files / 100 tests). CB-080 is fixed and re-checked on the device. CB-082 (Expo Go push chunk warning) is still visible in Metro and stays a Phase 3 item.
- Hosted Supabase database: every migration in the repo through `202609060302_expo_push_tickets` is applied (the founder ran the management-API script on 2026-09-07; verified: `receivers.consentResendCount integer NOT NULL DEFAULT 0`, `expo_push_tickets` with RLS on and no policies). Future migrations go the same way until `_prisma_migrations` is baselined (pattern in `docs/handoffs/data-security-and-privacy.md`).
- Auth: access tokens are verified locally; the hosted project publishes an ES256 JWKS key, so `SUPABASE_JWT_SECRET` is not needed. The service-role key is optional and never read (founder decision 2026-09-06).
- Nothing is hosted. The scheduler workflow is disabled. No Twilio, RevenueCat, FCM or EAS credentials exist; `docs/providers/twilio.md` and `docs/providers/whatsapp.md` say exactly what to configure when they do.
- 11 Dependabot PRs are open, deferred.

## Next session opener

1. On `master`: `git status --short --branch`, `npm ci` (the lockfile gained `jose` in #35), then `npm run verify`.
2. Sprint 3 wave 2 = CB-042 (zod body validation, one schema per body, shared with mobile; fold in CB-084, the `upsertFromSupabaseIdentity` alias removal) and CB-047 (logging; also write `TwilioRequestError.failureReason` into `attempt.failureReason` at the two `PROVIDER_SEND_FAILED` sites in `check-ins.service.ts`), plus CB-085 (push-receipts cron route). Two worktree agents with disjoint ownership (controllers, pipe and shared-types vs services' catch blocks, logger and middleware), a reviewer agent per PR before merge, then `docs/EMULATOR_RUNBOOK.md` again (ask before starting Docker or the emulator). Next free backlog id: CB-086.
3. Founder items that do not block wave 2: decision 3 (voice languages); create the WhatsApp templates once Twilio credentials exist (or build CB-083 first).
4. Then sprint 4 = Phase 3 mobile completion; then Dependabot triage (11 PRs), the one-off Prettier formatting commit and the `format:check` CI gate.

## Gotchas

- Windows. PowerShell is the primary shell (`npm.cmd`); Git Bash also works. Long paths break `git worktree remove` on directories with `node_modules`; use `Remove-Item -LiteralPath "\\?\<path>" -Recurse -Force`.
- npm 10.9 crashes with "edgesOut" when a root devDependency forces a hoisted `vitest` upgrade. Keep `vitest` and `@vitest/coverage-v8` at 4.1.5 at the root. Never delete `package-lock.json`.
- Prisma 7. `DATABASE_URL` lives in `apps/backend/prisma.config.ts`. A fresh `npm ci` does not generate the client; CI and `npm run verify` run `prisma:generate` first.
- Supabase. The account has three projects; the Nearby one is whatever `apps/backend/.env` `DATABASE_URL` points at, never chosen by name. The direct `db.<ref>` host is IPv6-only from this network; use the session pooler on port 5432. `supabase db push` and the Supabase MCP do not work (migration drift, 401); apply SQL through node `pg`.
- Emulator. Host is `10.0.2.2`. Expo Go cannot receive remote push. The Pixel_7 AVD is shared with other projects and may resume showing another app. `adb shell input text` works when the right field is focused first (`uiautomator dump` for bounds); earlier "corruption" was taps landing in the wrong field.
- Environment shadowing. Expo and dotenv never override a variable that already exists in the process environment. A Windows user-level `EXPO_PUBLIC_SUPABASE_URL` from another project silently pointed the app at the wrong Supabase project on 2026-09-06; it was deleted. Keep all `EXPO_PUBLIC_*`, `SUPABASE_*` and `DATABASE_URL` values in the per-project `.env` files only.
- Local `apps/backend/.env` carries no `DATABASE_URL` or KMS key and a placeholder service-role key (unused, CB-025); supply the run-time values through the shell, as the runbook does. The Supabase anon keys in both env files are valid and identical.
- Worktrees. Launch worktree agents only with the shell at the repo root (a nested worktree was created once). The local gitleaks hook is skipped inside linked worktrees. Agents stop when a background verify is running: nudge them to finish. GitHub runs no CI on a PR that conflicts with master: rebase first. Remove finished worktrees with `Remove-Item -LiteralPath "\\?\<path>" -Recurse -Force` then `git worktree prune` (each holds ~800 MB of `node_modules`). Agents sharing one scratchpad overwrite each other's files: tell them to use unique file names.
- Metro. Start with `--clear` after pulling new code; `CI=1` mode served a stale screen module once. Two "Remove" buttons exist on the receiver detail (backup row and receiver).
- Hooks. Pre-commit formats staged files with Prettier and scans them for secrets; pre-push runs gitleaks via Docker, lint and type-check.
- Timestamps read through node `pg` from `timestamp(3)` columns appear shifted by the local UTC offset; the database stores UTC.

- Tooling under auto mode. The classifier blocks `git filter-branch`, history rewrites bundled with a force-push, `gh pr merge --delete-branch` and some `sed -i` edits of `.gitleaks.toml`; plain `gh pr merge --squash` (delete-on-merge is on at GitHub), `git push --force-with-lease` on a feature branch after a rebase, and the Edit tool all work. Never put backticks inside a double-quoted shell string: bash executes them.
- CI gitleaks scans every commit of a PR, so a renamed fixture still fails on the commit that introduced the old name; the value-exact allowlist in `.gitleaks.toml` is the documented fix. GitGuardian (not a required check) flags a bearer fixture next to a UUID; dismiss it in its dashboard.
- After a rebase that changes `package-lock.json`, run `npm ci` in that worktree before `npm run verify`.
- Git Bash rewrites `/sdcard/...` in `adb shell` arguments; prefix with `MSYS_NO_PATHCONV=1`. Expo Go may be missing after an AVD reset (Expo CLI installs it) and can hang on first launch: force-stop and reopen `exp://<host>:8081`. The throwaway database needs a seeded subscription before the receiver form submits (runbook §2).

## Where the history lives

- `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` — every slice from 2026-04-26 to 2026-09-06. Its section index starts at line 5; §0 and §0a near line 789 are the newest entries; §1 to §34 are chronological from 2026-04-27 to 2026-05-18.
- `docs/audits/2026-09-05/` — the four audits that produced the backlog. `docs/audits/2026-09-06/sprint1-acceptance.md` — the sprint-1 acceptance run.
- `docs/superpowers/` — plans and specs from April and May 2026.
- `git log` and PR descriptions — per-change narrative.
