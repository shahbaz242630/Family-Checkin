#!/usr/bin/env node
// Creates a database if it does not exist. Used by the Database workflow to
// create the drift-check shadow database next to the CI database.
//
//   node scripts/db/ensure-database.mjs postgresql://ci:ci@localhost:5432/ci_shadow
//   SHADOW_DATABASE_URL=... npm run db:ensure-database
//
// Connects to the `postgres` maintenance database on the same server (falling
// back to DATABASE_URL) and issues CREATE DATABASE when needed.
import { ensureDatabaseExists, redactUrl } from './lib.mjs';

const target = (process.argv[2] ?? process.env.SHADOW_DATABASE_URL ?? '').trim();
if (!target) {
  console.error('usage: node scripts/db/ensure-database.mjs <postgresql-url>   (or set SHADOW_DATABASE_URL)');
  process.exit(2);
}

console.log(`ensure-database -> ${redactUrl(target)}`);
ensureDatabaseExists(target)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`ensure-database failed: ${error.message}`);
    process.exit(1);
  });
