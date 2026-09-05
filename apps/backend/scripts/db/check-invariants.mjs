#!/usr/bin/env node
// Database invariants for the Nearby backend database. Usage (from apps/backend):
//
//   DATABASE_URL=postgresql://ci:ci@localhost:5432/ci npm run db:check-invariants
//
// Connects with DATABASE_URL, prints a report and exits 1 on any violation.
// Run it after db:apply-all. Every assertion cites the SQL file or handoff
// section that establishes the intent, so a failure points at the decision
// that was broken rather than at this script.
//
// Checks:
//   A  every table in `public` has ROW LEVEL SECURITY enabled (partitions
//      included), except the explicit RLS_DISABLED_ALLOWLIST
//   A2 no table has FORCE ROW LEVEL SECURITY (the backend connects as the
//      table owner and has no write policies; forcing would lock it out)
//   B  every RLS-enabled table either has a policy or is registered in
//      INTERNAL_ONLY_NO_POLICIES with a reason; partitions carry no policies
//   C  no INSERT / UPDATE / DELETE is granted to PUBLIC on any public table
//   D  the partitioned operational-log objects exist and keep their shape
//   E  the expected policies exist with the intended command
//   F  every policy is PERMISSIVE, scoped through auth.uid(), and SELECT-only
//      apart from the allowlisted receivers_modify_own
//   G  audit_logs is append-only (triggers + hardened trigger function)
//   H  extensions live outside `public` (pg_trgm in `extensions`)
//   I  the scheduler partial indexes from supabase_setup.sql exist
//   J  every migration in prisma/migrations is applied and finished
//   K  every manual SQL file in the apply-all plan is recorded as applied
import {
  MANUAL_SQL_TABLE,
  buildManualSqlPlan,
  listMigrationDirectories,
  readSql,
  redactUrl,
  requireUrl,
  sha256,
  tableExists,
  withClient,
} from './lib.mjs';

// ---------------------------------------------------------------------------
// Sources of intent (cited in every assertion message)
// ---------------------------------------------------------------------------
const SRC = {
  setup: 'apps/backend/prisma/supabase_setup.sql',
  checkInsRls: 'apps/backend/prisma/20260427_check_ins_read_rls.sql',
  internalRls: 'apps/backend/prisma/20260430_internal_tables_rls.sql',
  warnFixes: 'apps/backend/prisma/20260430_security_advisor_warn_fixes.sql',
  surfaceHardening: 'apps/backend/prisma/20260509_existing_surface_rls_hardening.sql',
  attemptsMigration: 'apps/backend/prisma/migrations/202605010001_check_in_attempts/migration.sql',
  voiceMigration: 'apps/backend/prisma/migrations/202605100001_twilio_voice_readiness/migration.sql',
  partitions: 'supabase/migrations/20260510181345_partitioned_operational_logs.sql',
  partitionRls: 'apps/backend/scripts/db/sql/20260905_partition_rls_hardening.sql',
  applyAll: 'apps/backend/scripts/db/apply-all.mjs',
  handoffStatus: 'PROJECT_HANDOFF.md "Supabase Status"',
  handoff24: 'PROJECT_HANDOFF.md s24 "Supabase Security Advisor RLS hardening"',
  handoff25: 'PROJECT_HANDOFF.md s25 "Supabase Security Advisor WARN fixes"',
  handoff29h: 'PROJECT_HANDOFF.md s29h "Existing-surface production readiness audit"',
  handoffPartitions: 'PROJECT_HANDOFF.md "Supabase partitioned operational logs migration applied 2026-05-10"',
};

// ---------------------------------------------------------------------------
// Allowlists (each entry needs a reason; the check fails on stale entries)
// ---------------------------------------------------------------------------

// A: tables that may have RLS disabled.
const RLS_DISABLED_ALLOWLIST = {
  _prisma_migrations:
    'Prisma Migrate bookkeeping, created by `prisma migrate deploy` without RLS and only ever read/written by Prisma as the ' +
    `database owner. ${SRC.partitionRls} enables RLS on it once apply-all has run; until then it is the documented exception.`,
};

// B: RLS enabled, zero policies, deny-by-default for PostgREST clients; the
// NestJS backend reaches these tables as the database owner / service role.
const INTERNAL_ONLY_NO_POLICIES = {
  admin_users: `${SRC.handoff24} / ${SRC.internalRls}: internal deny-by-default table, backend/service-role only`,
  channel_templates: `${SRC.handoff24} / ${SRC.internalRls}: internal deny-by-default table, backend/service-role only`,
  idempotency_keys: `${SRC.handoff24} / ${SRC.internalRls}: internal deny-by-default table, backend/service-role only`,
  step_up_challenges: `${SRC.surfaceHardening} / ${SRC.handoff29h}: step-up codes and tokens are issued and verified by the backend only`,
  device_tokens: `${SRC.surfaceHardening} / ${SRC.handoff29h}: push tokens are registered through the backend only`,
  voice_caller_id_pool: `${SRC.voiceMigration} / ${SRC.handoffPartitions}: "RLS enabled and no client policies, intentionally backend-only"`,
  receiver_voice_caller_id_assignments: `${SRC.voiceMigration} / ${SRC.handoffPartitions}: "RLS enabled and no client policies, intentionally backend-only"`,
  provider_webhook_events: `${SRC.partitions} / ${SRC.handoffPartitions}: raw provider webhook payloads, "intentionally backend-only"`,
  backup_contacts: `${SRC.setup} enables RLS with no policy; ${SRC.handoffStatus} "Current policies are intentionally minimal" - served through the backend`,
  co_monitors: `${SRC.setup} enables RLS with no policy; invitations/acceptance flow through the backend (${SRC.handoffStatus})`,
  escalation_events: `${SRC.setup} enables RLS with no policy; escalation timeline is read through backend endpoints (${SRC.handoffStatus})`,
  subscriptions: `${SRC.setup} enables RLS with no policy; billing state is written by RevenueCat webhooks via the backend (${SRC.handoffStatus})`,
  abuse_reports: `${SRC.setup} enables RLS with no policy; admin-only review queue (${SRC.handoffStatus})`,
  opt_out_cooldowns: `${SRC.setup} enables RLS with no policy; written by inbound STOP handling in the backend (${SRC.handoffStatus})`,
  escalation_events_archive: `${SRC.partitions}: archive of escalation_events, which has no client read policy either`,
  [MANUAL_SQL_TABLE]: `${SRC.applyAll}: manual-SQL bookkeeping, RLS on, no policies`,
  _prisma_migrations: `${SRC.partitionRls}: Prisma bookkeeping with RLS enabled, no client access`,
};

// D/B: partitioned parents and how their rows are meant to be reached.
const KNOWN_PARTITIONED_PARENTS = {
  provider_webhook_events: { partitionColumn: 'createdAt', source: SRC.partitions },
  check_in_attempts_archive: { partitionColumn: 'scheduledAt', source: SRC.partitions },
  audit_logs_archive: { partitionColumn: 'createdAt', source: SRC.partitions },
  escalation_events_archive: { partitionColumn: 'startedAt', source: SRC.partitions },
};

// E: policies that must exist, with the command they were created for.
const EXPECTED_POLICIES = [
  ['users', 'users_read_own', 'SELECT', SRC.setup],
  ['receivers', 'receivers_read_own', 'SELECT', SRC.setup],
  ['receivers', 'receivers_modify_own', 'ALL', SRC.setup],
  ['receivers', 'receivers_read_co_monitor', 'SELECT', SRC.setup],
  ['check_ins', 'check_ins_read_own', 'SELECT', `${SRC.checkInsRls} / ${SRC.surfaceHardening}`],
  ['check_ins', 'check_ins_read_co_monitor', 'SELECT', `${SRC.checkInsRls} / ${SRC.surfaceHardening}`],
  ['check_in_attempts', 'check_in_attempts_read_own', 'SELECT', SRC.attemptsMigration],
  ['check_in_attempts', 'check_in_attempts_read_co_monitor', 'SELECT', SRC.attemptsMigration],
  ['audit_logs', 'audit_logs_read_own', 'SELECT', SRC.setup],
  ['check_in_attempts_archive', 'check_in_attempts_archive_read_own', 'SELECT', SRC.partitions],
  ['check_in_attempts_archive', 'check_in_attempts_archive_read_co_monitor', 'SELECT', SRC.partitions],
  ['audit_logs_archive', 'audit_logs_archive_read_own', 'SELECT', SRC.partitions],
];

// F: the only policy that may grant anything beyond SELECT.
const WRITE_POLICY_ALLOWLIST = {
  'receivers.receivers_modify_own': `${SRC.setup}: senders manage their own receivers (FOR ALL, scoped to the owning user)`,
};

// G/H/I: named objects from the setup / hardening files.
const AUDIT_TRIGGERS = ['audit_logs_no_update', 'audit_logs_no_delete'];
const PARTIAL_INDEXES = [
  ['check_ins', 'idx_checkins_pending_scheduled'],
  ['check_in_attempts', 'idx_check_in_attempts_pending_scheduled'],
  ['subscriptions', 'idx_subscriptions_active'],
];

// ---------------------------------------------------------------------------
// Catalog snapshot
// ---------------------------------------------------------------------------
async function collect(client) {
  const q = async (text) => (await client.query(text)).rows;

  const tables = await q(`
    SELECT c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relispartition,
           parent.relname AS parent_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
    LEFT JOIN pg_class parent ON parent.oid = i.inhparent
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname`);

  const policies = await q(`
    SELECT tablename, policyname, cmd, permissive, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname`);

  // Equivalent to information_schema.role_table_grants filtered on
  // grantee = 'PUBLIC', but read from pg_class.relacl so it does not depend on
  // which role is running the check. aclexplode() grantee 0 is PUBLIC.
  const publicWriteGrants = await q(`
    SELECT c.relname, a.privilege_type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND a.grantee = 0 AND a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    ORDER BY 1, 2`);

  const functions = await q(`
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.prosecdef,
           p.proconfig,
           p.proacl IS NULL AS default_acl,
           EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
           ) AS public_execute_grant
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'`);

  const triggers = await q(`
    SELECT t.tgname, c.relname, t.tgenabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal`);

  const extensions = await q(`
    SELECT e.extname, n.nspname
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace`);

  const indexes = await q(`SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public'`);

  const primaryKeys = await q(`
    SELECT c.relname, array_agg(a.attname::text ORDER BY k.ordinality)::text[] AS columns
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE n.nspname = 'public' AND i.indisprimary
    GROUP BY c.relname`);

  const prismaMigrations = (await tableExists(client, 'public', '_prisma_migrations'))
    ? await q(
        `SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name`,
      )
    : null;

  const manualSql = (await tableExists(client, 'public', MANUAL_SQL_TABLE))
    ? await q(`SELECT filename, checksum FROM public.${MANUAL_SQL_TABLE}`)
    : null;

  return {
    tables,
    policies,
    publicWriteGrants,
    functions,
    triggers,
    extensions,
    indexes,
    primaryKeys,
    prismaMigrations,
    manualSql,
  };
}

// ---------------------------------------------------------------------------
// Check runner
// ---------------------------------------------------------------------------
const results = [];

function check(id, title, body) {
  const result = { id, title, assertions: 0, violations: [], notes: [] };
  const t = {
    assert(condition, message) {
      result.assertions += 1;
      if (!condition) result.violations.push(message);
      return Boolean(condition);
    },
    note(message) {
      result.notes.push(message);
    },
  };
  body(t);
  results.push(result);
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

function runChecks(ctx) {
  const tablesByName = new Map(ctx.tables.map((table) => [table.relname, table]));
  const policiesByTable = groupBy(ctx.policies, (policy) => policy.tablename);

  check('A', 'RLS enabled on every table in public', (t) => {
    t.assert(ctx.tables.length > 0, 'no tables found in schema public: run db:apply-all first');
    let allowlisted = 0;
    for (const table of ctx.tables) {
      if (table.relrowsecurity) {
        t.assert(true);
        continue;
      }
      const reason = RLS_DISABLED_ALLOWLIST[table.relname];
      if (reason) {
        allowlisted += 1;
        t.note(`${table.relname}: RLS disabled, allowlisted (${reason})`);
        t.assert(true);
        continue;
      }
      const hint = table.relispartition
        ? `partition of ${table.parent_name}; ${SRC.partitionRls} enables RLS on every partition`
        : `${SRC.setup} / ${SRC.surfaceHardening} enable RLS on every application table`;
      t.assert(false, `${table.relname}: ROW LEVEL SECURITY is disabled (${hint})`);
    }
    t.note(`${ctx.tables.length} tables checked, ${allowlisted} allowlisted with RLS disabled`);
  });

  check('A2', 'No table forces RLS onto its owner', (t) => {
    for (const table of ctx.tables) {
      t.assert(
        !table.relforcerowsecurity,
        `${table.relname}: FORCE ROW LEVEL SECURITY is set. The backend and Prisma connect as the table owner and there are ` +
          `no owner write policies, so forcing RLS locks the backend out (${SRC.handoffStatus}: "Backend writes remain service-role controlled")`,
      );
    }
    t.note(
      'FORCE is intentionally off everywhere: policies exist for PostgREST user-scoped reads, the owner bypasses them',
    );
  });

  check('B', 'Every RLS-enabled table has a scoped policy or is registered internal-only', (t) => {
    let withPolicies = 0;
    let internal = 0;
    let partitions = 0;
    for (const table of ctx.tables) {
      if (!table.relrowsecurity) continue;
      const own = policiesByTable.get(table.relname) ?? [];
      if (table.relispartition) {
        partitions += 1;
        t.assert(
          KNOWN_PARTITIONED_PARENTS[table.parent_name],
          `${table.relname}: partition of ${table.parent_name}, which is not a registered partitioned parent (add it to KNOWN_PARTITIONED_PARENTS with its access model)`,
        );
        t.assert(
          own.length === 0,
          `${table.relname}: partitions must not carry their own policies; policies live on the parent and apply to reads through it (${SRC.partitions})`,
        );
        continue;
      }
      const reason = INTERNAL_ONLY_NO_POLICIES[table.relname];
      if (own.length === 0) {
        internal += 1;
        t.assert(
          reason,
          `${table.relname}: RLS enabled with no policy and not registered as internal-only. Either add a user-scoped policy or ` +
            `register it in INTERNAL_ONLY_NO_POLICIES with a reason (${SRC.handoff25}: "each table should get a policy only when a product flow requires direct client access")`,
        );
      } else {
        withPolicies += 1;
        t.assert(
          !reason,
          `${table.relname}: registered as internal-only (no policies) but has ${own.length}: ${own.map((p) => p.policyname).join(', ')}. Update INTERNAL_ONLY_NO_POLICIES or drop the policy`,
        );
      }
    }
    for (const name of Object.keys(INTERNAL_ONLY_NO_POLICIES)) {
      t.assert(
        tablesByName.has(name),
        `${name}: registered in INTERNAL_ONLY_NO_POLICIES but does not exist; remove the stale entry`,
      );
    }
    t.note(
      `${withPolicies} tables with policies, ${internal} registered internal-only, ${partitions} partitions (parent policies apply)`,
    );
  });

  check('C', 'No INSERT / UPDATE / DELETE granted to PUBLIC on any table in public', (t) => {
    t.assert(true);
    for (const grant of ctx.publicWriteGrants) {
      t.assert(
        false,
        `${grant.relname}: ${grant.privilege_type} is granted to PUBLIC (${SRC.handoffStatus}: writes are backend/service-role only)`,
      );
    }
    t.note(`${ctx.tables.length} tables inspected via pg_class.relacl`);
  });

  check('D', 'Partitioned operational-log objects exist and keep their shape', (t) => {
    for (const [name, spec] of Object.entries(KNOWN_PARTITIONED_PARENTS)) {
      const parent = tablesByName.get(name);
      t.assert(
        parent && parent.relkind === 'p',
        `${name}: expected a partitioned table (relkind = p) - ${spec.source}`,
      );
      const def = tablesByName.get(`${name}_default`);
      t.assert(
        def && def.relispartition && def.parent_name === name,
        `${name}_default: default partition missing - ${spec.source}`,
      );
      const monthly = ctx.tables.filter((x) => x.parent_name === name && x.relname !== `${name}_default`);
      t.assert(
        monthly.length >= 1,
        `${name}: no monthly partitions; ensure_monthly_range_partitions() did not run - ${spec.source}`,
      );
      const pk = ctx.primaryKeys.find((x) => x.relname === name);
      t.assert(
        pk && pk.columns.join(',') === `${spec.partitionColumn},id`,
        `${name}: primary key must be ("${spec.partitionColumn}", "id") so it includes the partition key - ${spec.source}` +
          (pk ? ` (found ${pk.columns.join(',')})` : ' (no primary key)'),
      );
    }

    const ensure = ctx.functions.find((f) => f.proname === 'ensure_monthly_range_partitions');
    t.assert(ensure, `ensure_monthly_range_partitions(): function missing - ${SRC.partitions}`);
    if (ensure) {
      t.assert(
        ensure.args === 'parent_table regclass, partition_column text, start_month date, month_count integer',
        `ensure_monthly_range_partitions(): unexpected signature "${ensure.args}" - ${SRC.partitions}`,
      );
    }

    const archive = ctx.functions.find((f) => f.proname === 'archive_operational_logs_before');
    t.assert(archive, `archive_operational_logs_before(timestamp): function missing - ${SRC.partitions}`);
    if (archive) {
      t.assert(archive.prosecdef, `archive_operational_logs_before(): must be SECURITY DEFINER - ${SRC.partitions}`);
      t.assert(
        !archive.default_acl && !archive.public_execute_grant,
        `archive_operational_logs_before(): EXECUTE must be revoked from PUBLIC ("REVOKE ALL ... FROM PUBLIC", ${SRC.partitions})`,
      );
    }
    t.note(`${Object.keys(KNOWN_PARTITIONED_PARENTS).length} partitioned parents, 2 maintenance functions`);
  });

  check('E', 'Expected policies exist with the intended command', (t) => {
    for (const [table, name, cmd, source] of EXPECTED_POLICIES) {
      const policy = (policiesByTable.get(table) ?? []).find((p) => p.policyname === name);
      t.assert(policy, `${table}.${name}: policy missing (${source})`);
      if (policy)
        t.assert(policy.cmd === cmd, `${table}.${name}: expected FOR ${cmd}, found ${policy.cmd} (${source})`);
    }
    t.note(`${EXPECTED_POLICIES.length} expected policies`);
  });

  check('F', 'Policies are permissive, user-scoped through auth.uid(), and SELECT-only unless allowlisted', (t) => {
    for (const policy of ctx.policies) {
      const key = `${policy.tablename}.${policy.policyname}`;
      t.assert(
        policy.permissive === 'PERMISSIVE',
        `${key}: RESTRICTIVE policies are not part of the model (${SRC.setup})`,
      );
      t.assert(
        /auth\.uid\(\)/.test(policy.qual ?? ''),
        `${key}: USING expression does not reference auth.uid(); every client policy must be scoped to the signed-in user (${SRC.handoff25}: "Do not add broad policies")`,
      );
      if (policy.cmd !== 'SELECT') {
        t.assert(
          WRITE_POLICY_ALLOWLIST[key],
          `${key}: FOR ${policy.cmd} policy is not allowlisted; client writes stay with the backend (${SRC.handoffStatus}: "no user INSERT/UPDATE/DELETE policies were added")`,
        );
      }
    }
    for (const key of Object.keys(WRITE_POLICY_ALLOWLIST)) {
      const [table, name] = key.split('.');
      t.assert(
        (policiesByTable.get(table) ?? []).some((p) => p.policyname === name),
        `${key}: allowlisted write policy does not exist; remove the stale entry`,
      );
    }
    t.note(`${ctx.policies.length} policies inspected`);
  });

  check('G', 'audit_logs is append-only', (t) => {
    for (const name of AUDIT_TRIGGERS) {
      const trigger = ctx.triggers.find((x) => x.tgname === name && x.relname === 'audit_logs');
      t.assert(trigger, `${name}: trigger missing on audit_logs (${SRC.setup})`);
      if (trigger) t.assert(trigger.tgenabled !== 'D', `${name}: trigger is disabled (${SRC.setup})`);
    }
    const fn = ctx.functions.find((f) => f.proname === 'prevent_audit_log_modification');
    t.assert(fn, `prevent_audit_log_modification(): function missing (${SRC.setup})`);
    if (fn) {
      t.assert(
        (fn.proconfig ?? []).some((setting) => /^search_path=/.test(setting)),
        `prevent_audit_log_modification(): search_path is not pinned (${SRC.warnFixes}, Security Advisor function_search_path_mutable)`,
      );
    }
  });

  check('H', 'Extensions live outside public', (t) => {
    const trgm = ctx.extensions.find((e) => e.extname === 'pg_trgm');
    t.assert(trgm, `pg_trgm: extension missing (${SRC.setup})`);
    if (trgm)
      t.assert(
        trgm.nspname === 'extensions',
        `pg_trgm: installed in "${trgm.nspname}", expected "extensions" (${SRC.warnFixes})`,
      );
    for (const extension of ctx.extensions) {
      t.assert(
        extension.nspname !== 'public',
        `${extension.extname}: installed in public (Security Advisor extension_in_public, ${SRC.handoff25})`,
      );
    }
    t.note(`${ctx.extensions.length} extensions: ${ctx.extensions.map((e) => `${e.extname}@${e.nspname}`).join(', ')}`);
  });

  check('I', 'Scheduler partial indexes exist', (t) => {
    for (const [table, index] of PARTIAL_INDEXES) {
      t.assert(
        ctx.indexes.some((x) => x.indexname === index && x.tablename === table),
        `${table}.${index}: partial index missing (${SRC.setup})`,
      );
    }
  });

  check('J', 'Every Prisma migration in the repo is applied and finished', (t) => {
    const directories = listMigrationDirectories();
    t.assert(directories.length > 0, 'no migration directories found under apps/backend/prisma/migrations');
    t.assert(
      ctx.prismaMigrations,
      '_prisma_migrations table missing: `prisma migrate deploy` has not run (db:apply-all)',
    );
    if (!ctx.prismaMigrations) return;
    const applied = new Map(ctx.prismaMigrations.map((row) => [row.migration_name, row]));
    for (const name of directories) {
      const row = applied.get(name);
      t.assert(row, `${name}: not recorded in _prisma_migrations`);
      if (!row) continue;
      t.assert(row.finished_at, `${name}: recorded but not finished (failed migration)`);
      t.assert(!row.rolled_back_at, `${name}: recorded as rolled back`);
    }
    for (const name of applied.keys()) {
      t.assert(
        directories.includes(name),
        `${name}: applied in the database but missing from apps/backend/prisma/migrations`,
      );
    }
    t.note(`${directories.length} migration directories, ${applied.size} recorded`);
  });

  check('K', 'Every manual SQL file in the apply-all plan is recorded with its current checksum', (t) => {
    const plan = buildManualSqlPlan();
    t.assert(ctx.manualSql, `${MANUAL_SQL_TABLE} table missing: db:apply-all has not run against this database`);
    if (!ctx.manualSql) return;
    const recorded = new Map(ctx.manualSql.map((row) => [row.filename, row.checksum]));
    for (const item of plan) {
      const checksum = recorded.get(item.relativePath);
      t.assert(checksum, `${item.relativePath}: not recorded as applied (${SRC.applyAll})`);
      if (checksum) {
        t.assert(
          checksum === sha256(readSql(item.absolutePath)),
          `${item.relativePath}: content changed since it was applied; re-run db:apply-all`,
        );
      }
    }
    t.note(`${plan.length} manual SQL files in the plan`);
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function printReport(ctx, databaseUrl) {
  const partitions = ctx.tables.filter((x) => x.relispartition).length;
  const parents = ctx.tables.filter((x) => x.relkind === 'p').length;
  const regular = ctx.tables.length - partitions - parents;
  console.log('Database invariants');
  console.log(`  target: ${redactUrl(databaseUrl)}`);
  console.log(
    `  public: ${regular} tables, ${parents} partitioned parents, ${partitions} partitions; ${ctx.policies.length} policies`,
  );
  console.log('');

  let violations = 0;
  let assertions = 0;
  for (const result of results) {
    const status = result.violations.length === 0 ? 'PASS' : 'FAIL';
    console.log(`  ${status}  ${result.id.padEnd(2)} ${result.title} (${result.assertions} assertions)`);
    for (const note of result.notes) console.log(`           note: ${note}`);
    for (const violation of result.violations) console.log(`           - ${violation}`);
    violations += result.violations.length;
    assertions += result.assertions;
  }

  console.log('');
  console.log(`Result: ${results.length} checks, ${assertions} assertions, ${violations} violation(s)`);
  return violations;
}

async function main() {
  const databaseUrl = requireUrl('DATABASE_URL');
  const ctx = await withClient(databaseUrl, collect);
  runChecks(ctx);
  const violations = printReport(ctx, databaseUrl);
  process.exit(violations === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`check-invariants failed: ${error.message}`);
  process.exit(1);
});
