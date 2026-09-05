// Prisma config used only by scripts/db/drift-check.mjs:
//
//   prisma migrate diff --config scripts/db/prisma.drift.config.ts \
//     --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
//
// Same schema and migrations directory as ../../prisma.config.ts, plus the
// throwaway shadow database Prisma replays the migrations into (Prisma 7 has
// no --shadow-database-url flag; `datasource.shadowDatabaseUrl` is the only
// way to pass it). Paths are anchored on process.cwd(), which drift-check.mjs
// always sets to apps/backend.
//
// Prisma migration 202605010001_check_in_attempts calls Supabase's auth.uid(),
// which a plain PostgreSQL shadow database does not have. drift-check.mjs
// installs scripts/db/supabase-shim.sql on the shadow database before the
// diff; Prisma's shadow reset only recreates the `public` schema, so the
// `auth` schema survives it. (Prisma's own `migrations.initShadowDb` hook
// would do the same but is gated behind `experimental.externalTables`.)
import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

const backendDir = process.cwd();

export default defineConfig({
  schema: path.join(backendDir, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(backendDir, 'prisma', 'migrations'),
  },
  datasource: {
    url: env('DATABASE_URL'),
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
});
