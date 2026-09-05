# Security, Audit And Test Gates

How this repository is protected, what runs where, and what to do when a gate goes red. The public-facing disclosure policy is in the root `SECURITY.md`; this file is the engineering process.

Baseline established 2026-09-05, modelled on the AI Agent SAAS, Sandoq Kin and Tools Project repositories.

## 1. What runs on every pull request and push to master

| Check (required on master) | Workflow | What it proves |
| --- | --- | --- |
| **Verify** | `.github/workflows/ci.yml` | `npm ci`, Prisma client generation, ESLint (root, backend, mobile), `tsc --noEmit` for backend and mobile, `prisma validate`, backend build, all Vitest projects with V8 coverage thresholds. Coverage report uploaded as an artifact. |
| **Security scans** | `.github/workflows/ci.yml` | gitleaks on the pushed commits, workflow hygiene (`scripts/github-actions-security-check.mjs`), zero-dependency secret pattern scan (`scripts/secret-scan.mjs`), production dependency audit with reviewed exceptions (`scripts/dependency-audit.mjs`), zizmor workflow lint (SARIF to the Security tab). |
| **Dependency review** | `.github/workflows/ci.yml` | Blocks a PR that introduces a high/critical vulnerable package (pull requests only). |
| **Analyse** | `.github/workflows/codeql.yml` | CodeQL `javascript-typescript` with the `security-extended` query pack. Also weekly. |
| **Database invariants** | `.github/workflows/database.yml` | Brings up a throwaway Postgres, applies Prisma migrations plus the RLS SQL, then asserts RLS/policies/grants and that `schema.prisma` matches the migrations. |

Every action is pinned to a full commit SHA with a `# vX.Y.Z` comment, every workflow declares `permissions: contents: read` at the top, and no `pull_request` workflow may read a repository secret other than `GITHUB_TOKEN`. `scripts/github-actions-security-check.mjs` enforces all of that; Dependabot keeps the pins current.

## 2. Weekly sweep (non-blocking)

`.github/workflows/security-weekly.yml`, Mondays 04:17 UTC and on demand: full-history gitleaks, Trivy filesystem scan (CRITICAL/HIGH, fixable only), and a CycloneDX SBOM kept for 90 days.

## 3. Repository-level settings (GitHub)

- Secret scanning + push protection: on.
- Dependabot alerts + security updates: on. Version updates via `.github/dependabot.yml` (weekly, grouped minor/patch, 7-day cooldown, Expo/React Native majors excluded because they are coordinated upgrades).
- Private vulnerability reporting: on.
- Ruleset `protect-master`: pull request required, the five checks above required and up to date, linear history, no force-push, no deletion, zero required approvals (solo maintainer). Admins are not exempt.
- CodeQL and dependency review are free because the repository is public. If it is ever made private they need GitHub Code Security, or the two workflows must be disabled.

## 4. Local mirror of the gates

`npm install` writes git hooks through `scripts/install-hooks.mjs` (plain `sh`, work from Git Bash):

- `pre-commit`: `scripts/secret-scan.mjs --staged`, then Prettier on the staged files (re-staged automatically).
- `pre-push`: gitleaks via the pinned Docker image (skipped with a notice when Docker is absent), `npm run lint`, `npm run typecheck`.

`npm run verify` runs everything CI runs, in the same order. Individual pieces: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run security:workflows`, `npm run security:secrets`, `npm run security:deps`, `npm run security:gitleaks`.

## 5. When a gate is red

- **gitleaks / secret scan**: if the value is real, rotate it first, then remove it. If it is a fixture, prefer renaming the fixture to something obviously fake (`example-`, `fixture-`, lower-case dashed words). Only then add a value-exact entry to `.gitleaks.toml`; never allowlist a path for every rule.
- **Dependency audit**: run `npm audit fix` (never `--force` without reading what it will change). If the only fix is a major upgrade of Expo, React Native or Prisma, add an entry to `security/dependency-audit-allowlist.json` with a reason (why it is not reachable in production) and an expiry no more than a quarter away. The script fails again when the entry expires or stops matching.
- **Dependency review**: the PR added a vulnerable version; pick another version or drop the dependency.
- **Workflow hygiene**: pin the action to a SHA and add its name to `ALLOWED_ACTIONS` in `scripts/github-actions-security-check.mjs` in the same PR, with the reason in the PR description.
- **CodeQL**: fix the finding or dismiss it in the Security tab with a written justification; do not edit the query set to hide it.
- **Database invariants**: a new table needs RLS enabled and a policy (or an explicit internal-only entry in `apps/backend/scripts/db/check-invariants.mjs` with a reason). Schema drift means `schema.prisma` changed without `prisma migrate dev`.
- **Coverage thresholds**: thresholds in `vitest.config.ts` are a ratchet set from the measured baseline. Add tests; lowering a threshold needs a reason in the PR.

## 6. Backend runtime controls (for reviewers)

- Helmet default headers, CORS allow-list (`CORS_ALLOWED_ORIGINS`, localhost dev ports, requests without an Origin), global rate limit (`RATE_LIMIT_TTL_SECONDS` / `RATE_LIMIT_MAX_REQUESTS`, default 300 per 60 s per client IP) with `TRUST_PROXY` for hosting behind a load balancer. The cron route and provider webhooks are exempt because they are secret/signature authenticated and arrive in bursts.
- Twilio signature validation (HMAC-SHA1, timing-safe), WhatsApp/SMS shared-secret header, RevenueCat bearer token, operations cron secret (timing-safe), Supabase JWT verification per request, app-layer encryption of receiver PII, idempotency keys, no raw SQL.
- Environment is validated with zod on boot (`apps/backend/src/shared/config/app-config.service.ts`); the process refuses to start on a bad config.

## 7. Open items and rotation log

| Item | Status |
| --- | --- |
| Test-account password that appeared in `PROJECT_HANDOFF.md` (removed 2026-09-05, still in git history, repository is public) | **Rotate the account password.** Consider a history rewrite only if the account matters. |
| Supabase access token and database password pasted in chat during earlier sessions (handoff sections 30/31) | **Rotate both**; then update `apps/backend/.env` and any hosting secrets. |
| Supabase "leaked password protection" | Enable in the Supabase dashboard (Auth settings). |
| Scheduled workflow `operations-check-ins.yml` is disabled by GitHub for inactivity | Re-enable once the backend is hosted and `OPERATIONS_CHECK_INS_RUN_URL` / `OPERATIONS_CRON_SECRET` are set. |
| Expo SDK 54 / React Native 0.81 / Prisma 7.8 carry build-time advisories (see allowlist, expiry 2026-12-31) | Coordinated upgrade before the expiry. |
| Prettier `format:check` is not yet a CI gate (140 legacy files are unformatted) | Run `npm run format` in a dedicated commit after the outstanding `codex/production-readiness-gaps` branch merges, then add `format:check` to the Verify job. |
| Request-body validation uses TypeScript interfaces only; auth bearer parsing is duplicated per controller | Follow-up: zod schemas on `@Body()` and a shared `AuthGuard`. |
