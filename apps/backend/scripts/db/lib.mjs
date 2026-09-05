// Shared helpers for the database scripts in this directory:
//   apply-all.mjs        bring a database to production shape
//   check-invariants.mjs assert RLS / policy / grant / partition invariants
//   drift-check.mjs      fail when schema.prisma and prisma/migrations disagree
//   ensure-database.mjs  create a database (used for the drift-check shadow DB)
//
// Everything here uses the backend workspace's `pg` dependency and the `prisma`
// CLI from devDependencies; no extra packages.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(SCRIPT_DIR, '..', '..');
export const REPO_ROOT = path.resolve(BACKEND_DIR, '..', '..');
export const MIGRATIONS_DIR = path.join(BACKEND_DIR, 'prisma', 'migrations');
export const SUPABASE_SHIM_PATH = path.join(SCRIPT_DIR, 'supabase-shim.sql');

// Bookkeeping table apply-all creates in `public` to remember which manual SQL
// files (everything outside prisma/migrations) have already been applied.
export const MANUAL_SQL_TABLE = 'nearby_manual_sql_applied';

// ---------------------------------------------------------------------------
// Environment / URLs
// ---------------------------------------------------------------------------

export function requireUrl(name) {
  const value = (process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} is not set. Example: ${name}=postgresql://ci:ci@localhost:5432/ci`);
  }
  return value;
}

export function redactUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<unparseable database url>';
  }
}

export function databaseNameOf(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

export function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function readSql(absolutePath) {
  return fs.readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, '');
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function toRepoRelative(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
}

export function listMigrationDirectories() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(MIGRATIONS_DIR, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Manual SQL plan (everything that is not a Prisma migration)
// ---------------------------------------------------------------------------
//
// Order matters and is deliberate:
//   1. supabase_setup.sql          the "fresh rebuild" base: extensions, the
//                                  audit_logs append-only triggers, RLS on the
//                                  BRD tables, the owner/co-monitor read
//                                  policies and the partial indexes. This is
//                                  what the hosted project received when the
//                                  public schema was reset (handoff "Supabase
//                                  Status"). Not idempotent on its own, so it
//                                  runs with `tolerateExisting` (see
//                                  applySqlFile) and is recorded in the
//                                  bookkeeping table.
//   2. 20260427_check_ins_read_rls hosted patch: check_ins read policies
//   3. 20260430_internal_tables_rls hosted patch: deny-by-default RLS (handoff s24)
//   4. 20260430_security_advisor_warn_fixes  function search_path + pg_trgm
//                                  moved to `extensions` (handoff s25)
//   5. 20260509_existing_surface_rls_hardening  RLS on step_up_challenges and
//                                  device_tokens, policy backfill (handoff 29h)
//   6. supabase/migrations/*.sql   Supabase-CLI style migrations, sorted by
//                                  their timestamp prefix (partitioned
//                                  operational logs today)
//   7. scripts/db/sql/*.sql        hardening patches owned by this tooling,
//                                  sorted by their date prefix (partition RLS)
//
// `reset_public_schema_for_nearby.sql` is intentionally NOT part of the plan:
// it drops every app table and re-creates an older snapshot of the schema. It
// is a manual, approval-gated hosted-project reset tool.
const LOOSE_PRISMA_SQL_ORDER = [
  { file: 'supabase_setup.sql', tolerateExisting: true },
  { file: '20260427_check_ins_read_rls.sql', tolerateExisting: false },
  { file: '20260430_internal_tables_rls.sql', tolerateExisting: false },
  { file: '20260430_security_advisor_warn_fixes.sql', tolerateExisting: false },
  { file: '20260509_existing_surface_rls_hardening.sql', tolerateExisting: false },
];
const LOOSE_PRISMA_SQL_IGNORED = new Set(['reset_public_schema_for_nearby.sql']);

export function buildManualSqlPlan() {
  const prismaDir = path.join(BACKEND_DIR, 'prisma');
  const plan = [];

  const loose = fs
    .readdirSync(prismaDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name);
  const known = new Set([...LOOSE_PRISMA_SQL_ORDER.map((item) => item.file), ...LOOSE_PRISMA_SQL_IGNORED]);
  const unregistered = loose.filter((name) => !known.has(name));
  if (unregistered.length > 0) {
    throw new Error(
      `Unregistered SQL file(s) in apps/backend/prisma: ${unregistered.join(', ')}. ` +
        'Add each one to LOOSE_PRISMA_SQL_ORDER (or LOOSE_PRISMA_SQL_IGNORED) in apps/backend/scripts/db/lib.mjs ' +
        'so apply-all applies it in a deliberate position.',
    );
  }
  for (const item of LOOSE_PRISMA_SQL_ORDER) {
    const absolutePath = path.join(prismaDir, item.file);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Registered SQL file is missing: ${toRepoRelative(absolutePath)}`);
    }
    plan.push({ absolutePath, tolerateExisting: item.tolerateExisting, group: 'apps/backend/prisma' });
  }

  for (const absolutePath of listSqlFiles(path.join(REPO_ROOT, 'supabase', 'migrations'))) {
    plan.push({ absolutePath, tolerateExisting: true, group: 'supabase/migrations' });
  }

  for (const absolutePath of listSqlFiles(path.join(SCRIPT_DIR, 'sql'))) {
    plan.push({ absolutePath, tolerateExisting: false, group: 'apps/backend/scripts/db/sql' });
  }

  return plan.map((item) => ({ ...item, relativePath: toRepoRelative(item.absolutePath) }));
}

function listSqlFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name)
    .sort()
    .map((name) => path.join(directory, name));
}

// ---------------------------------------------------------------------------
// SQL execution
// ---------------------------------------------------------------------------

// Splits a SQL file into statements on top-level `;`, honouring `--` and
// `/* */` comments, single/double quoted identifiers/strings and
// dollar-quoted bodies ($$ ... $$ / $tag$ ... $tag$) so DO blocks and
// function bodies stay intact.
export function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (tag) {
        const marker = tag[0];
        const end = sql.indexOf(marker, i + marker.length);
        const stop = end === -1 ? sql.length : end + marker.length;
        current += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ';') {
      statements.push(current);
      current = '';
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  statements.push(current);
  return statements.map((statement) => statement.trim()).filter((statement) => stripSqlComments(statement).trim());
}

function stripSqlComments(statement) {
  return statement.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

export function summarizeStatement(statement) {
  const oneLine = stripSqlComments(statement).replace(/\s+/g, ' ').trim();
  return oneLine.length > 110 ? `${oneLine.slice(0, 107)}...` : oneLine;
}

// SQLSTATEs that mean "this object already exists". Only files flagged
// `tolerateExisting` (the historically non-idempotent ones) skip these; the
// existing definition wins, which is the same semantics as `IF NOT EXISTS`
// and as the "only if missing" backfill in 20260509_existing_surface_rls_hardening.sql.
const TOLERATED_SQLSTATES = new Map([
  ['42710', 'duplicate_object'], // policy / trigger / type already exists
  ['42P07', 'duplicate_table'], // table / index already exists
]);

// Runs one SQL file statement-by-statement inside a single transaction and,
// when `record` is true, upserts a row into the bookkeeping table in the same
// transaction so a file is never half-applied or double-recorded.
export async function applySqlFile(
  client,
  { absolutePath, tolerateExisting = false, record = true, log = console.log },
) {
  const relativePath = toRepoRelative(absolutePath);
  const sql = readSql(absolutePath);
  const checksum = sha256(sql);
  const statements = splitSqlStatements(sql);
  let applied = 0;
  let skipped = 0;

  await client.query('BEGIN');
  try {
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      const savepoint = `stmt_${index}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        await client.query(statement);
        applied += 1;
      } catch (error) {
        if (tolerateExisting && TOLERATED_SQLSTATES.has(error.code)) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          skipped += 1;
          log(`      skip ${error.code} ${TOLERATED_SQLSTATES.get(error.code)}: ${summarizeStatement(statement)}`);
        } else {
          error.message =
            `${relativePath} statement ${index + 1}/${statements.length} failed: ${error.message}\n` +
            `      ${summarizeStatement(statement)}`;
          throw error;
        }
      }
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
    if (record) {
      await client.query(
        `INSERT INTO public.${MANUAL_SQL_TABLE} (filename, checksum) VALUES ($1, $2)
         ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
        [relativePath, checksum],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
  return { applied, skipped, total: statements.length, checksum };
}

export async function ensureBookkeepingTable(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS public.${MANUAL_SQL_TABLE} (
       filename   text PRIMARY KEY,
       checksum   text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  // Internal-only: RLS on, no policies, so PostgREST clients are denied while
  // the database owner (backend / this script) keeps full access.
  await client.query(`ALTER TABLE public.${MANUAL_SQL_TABLE} ENABLE ROW LEVEL SECURITY`);
}

export async function tableExists(client, schema, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p')`,
    [schema, table],
  );
  return rows.length > 0;
}

// Map of repo-relative filename -> { checksum, appliedAt }. Empty when the
// bookkeeping table does not exist yet.
export async function readAppliedManualSql(client) {
  if (!(await tableExists(client, 'public', MANUAL_SQL_TABLE))) return new Map();
  const { rows } = await client.query(`SELECT filename, checksum, applied_at FROM public.${MANUAL_SQL_TABLE}`);
  return new Map(rows.map((row) => [row.filename, { checksum: row.checksum, appliedAt: row.applied_at }]));
}

// ---------------------------------------------------------------------------
// Supabase shim (plain PostgreSQL only)
// ---------------------------------------------------------------------------
//
// The RLS policies (and the Prisma migration 202605010001_check_in_attempts)
// call `auth.uid()`, which only exists on Supabase. On a plain PostgreSQL
// server we install supabase-shim.sql: the `auth` schema with a compatible
// `auth.uid()`, the `extensions` schema with pgcrypto / uuid-ossp preinstalled
// the way Supabase ships them, and the anon / authenticated / service_role
// roles. Detection is by the presence of `auth.uid()`, so a real Supabase
// database never receives the shim.
export async function hasAuthUid(client) {
  const { rows } = await client.query(`SELECT to_regprocedure('auth.uid()') IS NOT NULL AS present`);
  return rows[0].present === true;
}

export async function ensureSupabaseShim(client, log = console.log) {
  if (await hasAuthUid(client)) {
    log('      auth.uid() already exists (Supabase, or shim installed earlier): shim skipped');
    return false;
  }
  await client.query(readSql(SUPABASE_SHIM_PATH));
  log(`      plain PostgreSQL detected (no auth.uid()): installed ${toRepoRelative(SUPABASE_SHIM_PATH)}`);
  return true;
}

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

// Creates the database named in `targetUrl` if it does not exist, connecting
// to the `postgres` maintenance database on the same server (falls back to
// DATABASE_URL when `postgres` is not reachable).
export async function ensureDatabaseExists(targetUrl, log = console.log) {
  const name = databaseNameOf(targetUrl);
  if (!name) throw new Error(`No database name in ${redactUrl(targetUrl)}`);

  const candidates = [];
  const maintenance = new URL(targetUrl);
  maintenance.pathname = '/postgres';
  candidates.push(maintenance.toString());
  if (process.env.DATABASE_URL && databaseNameOf(process.env.DATABASE_URL) !== name) {
    candidates.push(process.env.DATABASE_URL);
  }

  let lastError;
  for (const adminUrl of candidates) {
    try {
      return await withClient(adminUrl, async (client) => {
        const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
        if (rows.length > 0) {
          log(`      database "${name}" already exists`);
          return false;
        }
        await client.query(`CREATE DATABASE ${quoteIdent(name)}`);
        log(`      created database "${name}"`);
        return true;
      });
    } catch (error) {
      lastError = error;
      // 3D000 invalid_catalog_name (no `postgres` db), 28000/28P01 auth failures: try the next candidate.
      if (!['3D000', '28000', '28P01'].includes(error.code)) throw error;
    }
  }
  throw lastError ?? new Error(`Could not reach a maintenance database for ${redactUrl(targetUrl)}`);
}

// ---------------------------------------------------------------------------
// Prisma CLI
// ---------------------------------------------------------------------------

export function resolvePrismaCli() {
  const require = createRequire(path.join(BACKEND_DIR, 'package.json'));
  const packageJsonPath = require.resolve('prisma/package.json');
  const { bin } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const entry = typeof bin === 'string' ? bin : bin.prisma;
  return path.join(path.dirname(packageJsonPath), entry);
}

// Runs `prisma <args>` (no shell; argv array) with the backend workspace as
// cwd so prisma.config.ts is picked up. Resolves with the exit code;
// stdout/stderr are inherited.
export function runPrisma(args, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolvePrismaCli(), ...args], {
      cwd: BACKEND_DIR,
      stdio: 'inherit',
      env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1', ...env },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
