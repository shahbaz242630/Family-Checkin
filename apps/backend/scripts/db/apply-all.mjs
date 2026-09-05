#!/usr/bin/env node
// Brings a database to production shape from scratch, or catches an existing
// one up. Usage (from apps/backend):
//
//   DATABASE_URL=postgresql://ci:ci@localhost:5432/ci npm run db:apply-all
//
// Steps, in order (each one is printed as it runs):
//   1. Supabase compatibility shim   only on plain PostgreSQL (no auth.uid()).
//                                    See supabase-shim.sql; never touches a
//                                    real Supabase database.
//   2. prisma migrate deploy         apps/backend/prisma/migrations, via the
//                                    prisma CLI from devDependencies.
//   3. Manual SQL, in the order documented in lib.mjs buildManualSqlPlan():
//        apps/backend/prisma/supabase_setup.sql
//        apps/backend/prisma/20260427_check_ins_read_rls.sql
//        apps/backend/prisma/20260430_internal_tables_rls.sql
//        apps/backend/prisma/20260430_security_advisor_warn_fixes.sql
//        apps/backend/prisma/20260509_existing_surface_rls_hardening.sql
//        supabase/migrations/*.sql               (sorted)
//        apps/backend/scripts/db/sql/*.sql        (sorted)
//
// Idempotency:
//   - Every manual SQL file is recorded in public.nearby_manual_sql_applied
//     (filename, sha256 checksum, applied_at) inside the same transaction that
//     applied it. Recorded files with an unchanged checksum are skipped; a
//     changed file is re-applied and its checksum updated.
//   - Files that are not idempotent by themselves (supabase_setup.sql and the
//     supabase/migrations) run in "tolerate existing" mode: a statement that
//     fails with 42710 duplicate_object / 42P07 duplicate_table is skipped and
//     the existing object wins. Any other error aborts the file's transaction
//     and the run.
//   - A .sql file in apps/backend/prisma that is neither registered in the
//     plan nor explicitly ignored fails the run, so new hosted patches cannot
//     be forgotten.
//
// Never runs apps/backend/prisma/reset_public_schema_for_nearby.sql: that file
// drops every application table and is a manual, approval-gated reset tool.
import {
  applySqlFile,
  buildManualSqlPlan,
  ensureBookkeepingTable,
  ensureSupabaseShim,
  readAppliedManualSql,
  readSql,
  redactUrl,
  requireUrl,
  runPrisma,
  sha256,
  withClient,
} from './lib.mjs';

async function main() {
  const databaseUrl = requireUrl('DATABASE_URL');
  const plan = buildManualSqlPlan();
  const totalSteps = 2 + plan.length;
  let step = 0;
  const announce = (title) => {
    step += 1;
    console.log(`\n[${step}/${totalSteps}] ${title}`);
  };

  console.log('Nearby database apply-all');
  console.log(`  target: ${redactUrl(databaseUrl)}`);

  announce('Supabase compatibility shim (plain PostgreSQL only)');
  await withClient(databaseUrl, (client) => ensureSupabaseShim(client));

  announce('prisma migrate deploy (apps/backend/prisma/migrations)');
  const exitCode = await runPrisma(['migrate', 'deploy']);
  if (exitCode !== 0) {
    throw new Error(`prisma migrate deploy exited with code ${exitCode}`);
  }

  const summary = { applied: 0, skipped: 0, reapplied: 0 };
  await withClient(databaseUrl, async (client) => {
    await ensureBookkeepingTable(client);
    const recorded = await readAppliedManualSql(client);

    for (const item of plan) {
      announce(item.relativePath);
      const previous = recorded.get(item.relativePath);
      if (previous && previous.checksum === sha256(readSql(item.absolutePath))) {
        console.log(`      already applied ${previous.appliedAt.toISOString()}: skipped`);
        summary.skipped += 1;
        continue;
      }
      if (previous) {
        console.log(
          `      content changed since it was applied ${previous.appliedAt.toISOString()}: re-applying` +
            (item.tolerateExisting ? ' (existing objects are kept)' : ''),
        );
      }
      const result = await applySqlFile(client, {
        absolutePath: item.absolutePath,
        tolerateExisting: item.tolerateExisting,
      });
      const skippedNote = result.skipped > 0 ? ` (${result.skipped} skipped: already existed)` : '';
      console.log(`      applied ${result.applied}/${result.total} statements${skippedNote}`);
      if (previous) summary.reapplied += 1;
      else summary.applied += 1;
    }
  });

  console.log(
    `\napply-all complete: ${summary.applied} file(s) applied, ${summary.reapplied} re-applied, ${summary.skipped} already applied.`,
  );
}

main().catch((error) => {
  console.error(`\napply-all failed: ${error.message}`);
  process.exit(1);
});
