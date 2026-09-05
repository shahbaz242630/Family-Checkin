#!/usr/bin/env node
// Schema drift check: fails when prisma/schema.prisma and prisma/migrations
// disagree, i.e. someone edited the schema without creating a migration (or
// hand-edited a migration). Usage (from apps/backend):
//
//   SHADOW_DATABASE_URL=postgresql://ci:ci@localhost:5432/ci_shadow npm run db:drift-check
//
// What it does:
//   1. asserts prisma/migrations/migration_lock.toml exists with provider = "postgresql"
//   2. creates the shadow database if missing and installs the Supabase shim
//      (auth.uid(), needed by migration 202605010001_check_in_attempts) on it
//      when it is plain PostgreSQL. Prisma's shadow reset only recreates the
//      `public` schema, so the shim in `auth` survives the replay.
//   3. runs `prisma migrate diff --from-migrations prisma/migrations
//      --to-schema prisma/schema.prisma --exit-code` with
//      scripts/db/prisma.drift.config.ts, which supplies the shadow database
//      URL. Prisma 7 has no --shadow-database-url flag; the config is the
//      only way to pass it.
//   4. exit 0 when the diff is empty, exit 1 (with the human-readable diff and
//      the SQL Prisma would generate) when it is not
//
// The shadow database is RESET by Prisma on every run. The script refuses a
// SHADOW_DATABASE_URL that equals DATABASE_URL or points at a Supabase host.
import fs from 'node:fs';
import path from 'node:path';
import {
  MIGRATIONS_DIR,
  databaseNameOf,
  ensureDatabaseExists,
  ensureSupabaseShim,
  redactUrl,
  requireUrl,
  runPrisma,
  withClient,
} from './lib.mjs';

const LOCK_FILE = path.join(MIGRATIONS_DIR, 'migration_lock.toml');
// Relative to apps/backend, which runPrisma() uses as cwd.
const DRIFT_CONFIG = 'scripts/db/prisma.drift.config.ts';
const DIFF_ARGS = ['--from-migrations', 'prisma/migrations', '--to-schema', 'prisma/schema.prisma'];

function assertMigrationLock() {
  if (!fs.existsSync(LOCK_FILE)) {
    throw new Error(
      `${LOCK_FILE} is missing. Prisma expects it next to the migrations; create it with provider = "postgresql".`,
    );
  }
  const contents = fs.readFileSync(LOCK_FILE, 'utf8');
  if (!/^\s*provider\s*=\s*"postgresql"\s*$/m.test(contents)) {
    throw new Error(`${LOCK_FILE} must declare provider = "postgresql".`);
  }
  console.log('      prisma/migrations/migration_lock.toml present, provider = "postgresql"');
}

function assertThrowawayShadow(shadowUrl, databaseUrl) {
  const shadow = new URL(shadowUrl);
  if (/(^|\.)supabase\.(co|com|in)$/i.test(shadow.hostname)) {
    throw new Error(
      'SHADOW_DATABASE_URL points at a Supabase host. Prisma resets the shadow database; use a throwaway database.',
    );
  }
  if (databaseUrl) {
    const main = new URL(databaseUrl);
    if (main.host === shadow.host && databaseNameOf(databaseUrl) === databaseNameOf(shadowUrl)) {
      throw new Error(
        'SHADOW_DATABASE_URL must be a different database from DATABASE_URL: Prisma resets the shadow database.',
      );
    }
  }
}

async function main() {
  const shadowUrl = requireUrl('SHADOW_DATABASE_URL');
  const databaseUrl = (process.env.DATABASE_URL ?? '').trim() || undefined;
  assertThrowawayShadow(shadowUrl, databaseUrl);

  console.log('Nearby schema drift check');
  console.log(`  shadow database: ${redactUrl(shadowUrl)}`);

  console.log('\n[1/3] migration_lock.toml');
  assertMigrationLock();

  console.log('\n[2/3] shadow database');
  await ensureDatabaseExists(shadowUrl);
  await withClient(shadowUrl, (client) => ensureSupabaseShim(client));

  console.log(`\n[3/3] prisma migrate diff ${DIFF_ARGS.join(' ')} --exit-code`);
  // The drift config reads DATABASE_URL through env(), which throws when the
  // variable is unset; the diff never connects to it, so fall back to the
  // shadow URL rather than requiring a second variable locally.
  const env = { SHADOW_DATABASE_URL: shadowUrl, DATABASE_URL: databaseUrl ?? shadowUrl };
  const exitCode = await runPrisma(['migrate', 'diff', '--config', DRIFT_CONFIG, ...DIFF_ARGS, '--exit-code'], { env });

  if (exitCode === 0) {
    console.log('\nNo drift: prisma/migrations produce exactly prisma/schema.prisma.');
    return;
  }
  if (exitCode === 2) {
    console.error('\nSQL that prisma/migrations is missing to reach schema.prisma:');
    await runPrisma(['migrate', 'diff', '--config', DRIFT_CONFIG, ...DIFF_ARGS, '--script'], { env });
    console.error(
      '\nDRIFT: prisma/schema.prisma differs from what prisma/migrations produce. ' +
        'Create a migration for the change (from apps/backend: npx prisma migrate dev --create-only --name <change>) ' +
        'or revert the schema edit.',
    );
    process.exit(1);
  }
  throw new Error(`prisma migrate diff exited with code ${exitCode}`);
}

main().catch((error) => {
  console.error(`\ndrift-check failed: ${error.message}`);
  process.exit(1);
});
