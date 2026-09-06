# Data, security and privacy — feature handoff

Status: Built · Last verified: 2026-09-06 (db:check-invariants on a throwaway Postgres: 12 checks, 630 assertions, 0 violations; hosted DB partition RLS fix applied 2026-09-05)
BRD: 9.4a (PII handling), 13.1.3b (retention/logs), 13.1.5 (encryption), FR-SAF-04 (audit trail) · Open backlog: CB-049, CB-051, CB-052, CB-054, CB-056, CB-059

## What it does

- Stores PII (email, phone, name, personal note, consent/response transcripts, abuse report text) as AES-256-GCM ciphertext; the database holds no plaintext PII.
- Keeps lookups and uniqueness working by storing a SHA-256 hex hash next to each encrypted phone/email, indexed, and unique on `users`.
- Appends an immutable audit trail for every state change, refusing at the application layer to persist raw PII in the metadata.
- Denies Supabase/PostgREST clients by default: RLS is on for every table in `public`; a short list has scoped SELECT policies and only one table has any client write policy.
- Partitions the four high-volume operational log tables into 24 monthly partitions plus a default, so retention jobs have somewhere to move rows.
- Rebuilds the full production schema on a throwaway Postgres in two commands, then asserts 12 structural invariants over the result (also a CI gate).

## Where it lives

| Layer   | Paths                                                                                                                                                                                                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend | `apps/backend/src/shared/crypto/crypto.service.ts`, `apps/backend/src/shared/phone/phone-normalizer.ts`, `apps/backend/src/modules/audit/`, `apps/backend/src/shared/prisma/prisma.service.ts`, `apps/backend/src/shared/config/app-config.service.ts`                                |
| Mobile  | none — this feature owns no mobile surface                                                                                                                                                                                                                                          |
| Data    | `apps/backend/prisma/schema.prisma`; `apps/backend/prisma/migrations/` (9); `apps/backend/prisma/supabase_setup.sql` + 4 hosted RLS patches; `supabase/migrations/20260510181345_partitioned_operational_logs.sql`; `apps/backend/scripts/db/sql/20260905_partition_rls_hardening.sql` |
| Tooling | `apps/backend/scripts/db/{apply-all,check-invariants,drift-check,ensure-database}.mjs` + `lib.mjs` + `supabase-shim.sql`; `apps/backend/prisma.config.ts`; `.github/workflows/database.yml`                                                                                           |
| Tests   | `crypto.service.spec.ts`, `audit.service.spec.ts`, `prisma-audit.repository.spec.ts`, `app-config.service.spec.ts`, `phone-normalizer.spec.ts`                                                                                                                                       |

Prisma models by domain (19 models, all snake_case `@@map`ped, all UUID PKs defaulted DB-side with `gen_random_uuid()`):

- People and consent — `User`, `Receiver`, `BackupContact`, `CoMonitor`.
- Check-in lifecycle — `CheckIn`, `CheckInAttempt`, `EscalationEvent`.
- Channels and provider plumbing — `ChannelTemplate`, `ProviderWebhookEvent`, `VoiceCallerIdPool`, `ReceiverVoiceCallerIdAssignment`, `DeviceToken`.
- Safety and compliance — `AuditLog`, `AbuseReport`, `OptOutCooldown`.
- Billing — `Subscription`. Access and request control — `AdminUser`, `StepUpChallenge`, `IdempotencyKey`.
- SQL-only tables not in `schema.prisma`: `check_in_attempts_archive`, `audit_logs_archive`, `escalation_events_archive` (partitioned), `nearby_manual_sql_applied`, `_prisma_migrations`.

Encrypted columns: `users.emailEncrypted/phoneEncrypted`, `receivers.nameEncrypted/phoneEncrypted/personalNoteEncrypted/consentTranscript`, `backup_contacts.nameEncrypted/phoneEncrypted/locationInstructionsEncrypted`, `check_in_attempts.responseTranscript`, `abuse_reports.reportContent`, `admin_users.emailEncrypted`.
Hashed columns: `users.emailHash/phoneHash` (unique), `receivers.phoneHash`, `backup_contacts.phoneHash`, `abuse_reports.reporterPhoneHash`, `admin_users.emailHash`, plus `step_up_challenges.codeHash/tokenHash` (same SHA-256, separate call site in `step-up.service.ts`).

## Routes and contracts

This feature owns scripts, not HTTP routes. All run from `apps/backend` and read `DATABASE_URL`.

- `npm run db:apply-all` — brings any database to production shape. Step 1 installs `supabase-shim.sql` (the `auth` schema and a compatible `auth.uid()`, `extensions` with pgcrypto/uuid-ossp, the anon/authenticated/service_role roles) only when `auth.uid()` is absent, so a real Supabase database never receives it. Step 2 runs `prisma migrate deploy`. Step 3 applies the manual SQL in the fixed order in `lib.mjs buildManualSqlPlan()`: `supabase_setup.sql`, the four dated `prisma/*.sql` patches, `supabase/migrations/*.sql`, `scripts/db/sql/*.sql`. Each file is applied statement-by-statement in one transaction and recorded (filename, sha256, applied_at) in `nearby_manual_sql_applied` in the same transaction; unchanged checksums are skipped, changed ones re-applied.
- `npm run db:check-invariants` — connects, prints a report, exits 1 on any violation. 12 checks: (A) RLS enabled on every table in `public` including partitions, (A2) no FORCE RLS, (B) every RLS table has a policy or an explicit internal-only entry with a reason, (C) no INSERT/UPDATE/DELETE granted to PUBLIC, (D) the partitioned parents, their `_default` partitions, composite PKs and the two maintenance functions keep their shape, (E) the expected policies exist with the intended command, (F) every policy is PERMISSIVE, scoped through `auth.uid()` and SELECT-only apart from `receivers_modify_own`, (G) `audit_logs` append-only triggers and hardened trigger function, (H) `pg_trgm` lives in `extensions`, (I) the three scheduler partial indexes exist, (J) every migration in `prisma/migrations` is applied and finished, (K) every manual SQL file in the plan is recorded with a matching checksum.
- `npm run db:drift-check` — needs `SHADOW_DATABASE_URL`; fails when `schema.prisma` and `prisma/migrations` disagree. Refuses a shadow URL equal to `DATABASE_URL` or pointing at a Supabase host.
- `npm run db:ensure-database` — creates the database named in the URL (used for the drift-check shadow DB).
- `npm run prisma:validate` / `prisma:generate` — need any syntactically valid `DATABASE_URL`, real or dummy.

## How to exercise it locally (fake mode)

- Start the throwaway Postgres from `docs/EMULATOR_RUNBOOK.md` §2, then `npm.cmd --prefix apps/backend run db:apply-all` followed by `db:check-invariants` (must pass). Reset by deleting the container and repeating.
- The shim makes plain Postgres behave like Supabase for RLS purposes, so the same SQL and the same invariants run locally and hosted.
- To exercise the crypto and audit guard without a database: `npm.cmd --prefix apps/backend test -- src/shared/crypto/crypto.service.spec.ts src/modules/audit`.
- Seeding rows by hand (as the sprint 1 acceptance run did) means encrypting with the same layout `CryptoService` produces and hashing lookups with plain SHA-256; anything else is unreadable to the backend.

## Invariants — do not break

- `KMS_MASTER_KEY_BASE64` must decode to exactly 32 bytes; `AppConfigService` throws on boot otherwise and `CryptoService` throws on construction. There is no fallback key.
- Ciphertext layout is `base64(iv[12] | authTag[16] | ciphertext)` with a fresh random IV per value. Changing the order, the lengths or the encoding orphans every stored row; there is no key id or version prefix to migrate through (CB-052).
- Lookup hashes are unsalted `sha256(value).hex` over the E.164-normalised phone (`normalizePhone`, libphonenumber-js). Normalise before hashing or encrypting, or lookups silently miss.
- `audit_logs` is append-only in the database: triggers `audit_logs_no_update` / `audit_logs_no_delete` call `prevent_audit_log_modification()`, which must stay `SECURITY`-hardened with `search_path = public, pg_temp`. Never add an UPDATE/DELETE path.
- `AuditService.append` walks the metadata and throws on any key matching `/(email|phone|name|address|note|transcript|location|contact)/i` unless the key ends in `Id`/`Ids`/`Ref`, and on any string value shaped like an email or phone number. Pass ids and counts, never values.
- Audit `action` is dotted snake_case scoped by domain (`check_in.sent`, `escalation.backup_contact_alerted`, `backup_contact.created`, `account.deleted`); `entityType` is the bare table-ish noun (`check_in`, `receiver`, `user`, `abuse_report`) and `entityId` is a UUID. `AuditLog.metadata` is `Json?`.
- Every new table in `public` needs RLS enabled plus either a policy or an entry in `INTERNAL_ONLY_NO_POLICIES` in `check-invariants.mjs` with a reason; stale entries fail the check.
- Deny-by-default internal tables (RLS on, zero policies): `admin_users`, `channel_templates`, `idempotency_keys`, `step_up_challenges`, `device_tokens`, `voice_caller_id_pool`, `receiver_voice_caller_id_assignments`, `provider_webhook_events`, `backup_contacts`, `co_monitors`, `escalation_events`, `subscriptions`, `abuse_reports`, `opt_out_cooldowns`, `escalation_events_archive`, `nearby_manual_sql_applied`, `_prisma_migrations`.
- Client read policies exist only on `users` (own), `receivers` (own, co-monitor), `check_ins` (own, co-monitor), `check_in_attempts` (own, co-monitor), `audit_logs` (own), and the `check_in_attempts_archive` / `audit_logs_archive` mirrors. `receivers_modify_own` is the single non-SELECT policy and the only allowlisted one; all other writes go through the backend as the table owner.
- PostgreSQL does not inherit RLS from a partitioned parent. `ensure_monthly_range_partitions(parent regclass, column text, start_month date, month_count int)` enables RLS on every partition it creates and must keep that signature and that `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. `archive_operational_logs_before(timestamp)` must stay `SECURITY DEFINER` with EXECUTE revoked from PUBLIC.
- Partitioned parents (`provider_webhook_events` by `createdAt`, `check_in_attempts_archive` by `scheduledAt`, `audit_logs_archive` by `createdAt`, `escalation_events_archive` by `startedAt`) each carry 24 monthly partitions plus `_default`, and their primary key must be `(<partition column>, id)` — Postgres requires the partition key in every unique index.
- Hosted database facts: there is no `_prisma_migrations` table on the hosted project because migrations were applied by hand. Baseline with `prisma migrate resolve --applied <name>` for each existing migration before ever running `prisma migrate deploy` against it, or keep applying SQL by hand. The Supabase project ref lives only in `apps/backend/.env`.
- Prisma 7 quirk: `DATABASE_URL` is declared in `apps/backend/prisma.config.ts` (`datasource: { url: env('DATABASE_URL') }`), not in `schema.prisma`. Prisma 7 also has no `--shadow-database-url` flag, which is why `drift-check` ships `scripts/db/prisma.drift.config.ts`. CLI commands must run with `apps/backend` as cwd so the config is picked up.
- `apply-all` refuses to run if a `.sql` file appears in `apps/backend/prisma` without being registered in `LOOSE_PRISMA_SQL_ORDER` or `LOOSE_PRISMA_SQL_IGNORED`. `reset_public_schema_for_nearby.sql` is deliberately ignored: it drops every application table.
- CI gate details, secret scanning and the rotation log are in `docs/SECURITY.md` (sections 1, 5, 6 and 7) — not duplicated here.

## Known gaps

- CB-049 — 13 module-local `PrismaService` providers mean 13 connection pools per process; needs one `@Global()` `PrismaModule`.
- CB-051 — plaintext `From`/`To` are stored in `provider_webhook_events.payload` and never purged on account deletion.
- CB-052 — the lookup hash is unsalted SHA-256 (enumerable) and ciphertext carries no key id, so key rotation is a big-bang.
- CB-054 — audit `ipAddress` comes from a spoofable `x-forwarded-for`; admin reads, step-up and export are not audited.
- CB-056 — nothing schedules partition maintenance: months past the pre-created 24 fall into `_default` and the helper then fails; `archive_operational_logs_before` is never called.
- CB-059 — no retention job: no soft-delete window, no hard-delete purge, no 6-year audit archive.

## History

- Archived handoff: `docs/archive/PROJECT_HANDOFF_2026-04-26_to_2026-09-06.md` "Supabase Status" (lines 85–183), §24 RLS hardening (1964–1991), §25 Security Advisor WARN fixes (1992–2032), §29e (2384–2438), §29h existing-surface audit (2519–2582), partitioned operational logs applied 2026-05-10 (563–586), Prisma 7 note (781–784).
- Audits: `docs/audits/2026-09-05/backend-robustness.md`, `docs/audits/2026-09-06/sprint1-acceptance.md` (SQL seeding used the same ciphertext layout and hash).
- PRs: #18 (audit PII guard exempts `Id`/`Ids`/`Ref` keys, CB-002).
