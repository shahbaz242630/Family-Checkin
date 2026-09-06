#!/usr/bin/env node
// Seeds the Twilio voice caller-ID pool (voice_caller_id_pool) so outbound check-in calls can use a sticky,
// country-matched caller ID (CB-022). Idempotent: a number already in the pool is updated in place, never
// duplicated, and re-running with the same numbers changes nothing but "updatedAt".
//
//   DATABASE_URL=... node scripts/db/seed-caller-ids.mjs --numbers=+15551234567,+447700900123
//   DATABASE_URL=... VOICE_CALLER_IDS=+15551234567:US,+447700900123 npm run db:seed-caller-ids
//   ... --status=DISABLED    ACTIVE (default) puts a number in rotation; DISABLED or COMPLIANCE_BLOCKED takes it out
//   ... --dry-run            print the plan, write nothing
//
// Each entry is an E.164 number, optionally followed by ":XX" (ISO 3166-1 alpha-2) when the country cannot be
// derived from the number (+1 is shared by the US and Canada; libphonenumber usually resolves it, not always).
// Every seeded row is provider "twilio" with complianceStatus "APPROVED", which is exactly what
// PrismaVoiceCallerIdRepository.resolveForReceiver selects, so only numbers Twilio has verified for that country
// belong here (docs/providers/twilio.md).
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { redactUrl, requireUrl, withClient } from './lib.mjs';

const STATUSES = new Set(['ACTIVE', 'DISABLED', 'COMPLIANCE_BLOCKED']);
const E164 = /^\+[1-9]\d{7,14}$/;
const COUNTRY = /^[A-Z]{2}$/;

function parseArgs(argv) {
  const options = { numbers: undefined, status: 'ACTIVE', dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--numbers=')) {
      options.numbers = arg.slice('--numbers='.length);
    } else if (arg.startsWith('--status=')) {
      options.status = arg.slice('--status='.length).trim().toUpperCase();
    } else {
      throw new UsageError(`unknown argument ${arg}`);
    }
  }
  if (!STATUSES.has(options.status)) {
    throw new UsageError(`--status must be one of ${[...STATUSES].join(', ')}`);
  }
  return options;
}

// "+15551234567" or "+15551234567:US" -> { phoneNumber, countryCode }
export function parseCallerIdEntries(raw) {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new UsageError('no numbers given: pass --numbers=+1...,+44... or set VOICE_CALLER_IDS');
  }

  const seen = new Set();
  return entries.map((entry) => {
    const [phoneNumber, explicitCountry, ...rest] = entry.split(':');
    if (rest.length > 0 || !E164.test(phoneNumber)) {
      throw new UsageError(`"${maskNumber(phoneNumber)}" is not an E.164 number (expected +<country><number>[:XX])`);
    }
    if (seen.has(phoneNumber)) {
      throw new UsageError(`${maskNumber(phoneNumber)} is listed twice`);
    }
    seen.add(phoneNumber);

    const countryCode = (explicitCountry ?? parsePhoneNumberFromString(phoneNumber)?.country ?? '').toUpperCase();
    if (!COUNTRY.test(countryCode)) {
      throw new UsageError(
        `cannot derive the country of ${maskNumber(phoneNumber)}; append ":XX" with its ISO 3166-1 alpha-2 code`,
      );
    }
    return { phoneNumber, countryCode };
  });
}

// Our own Twilio numbers are not personal data, but the console log of a deploy box should not list them in full.
export function maskNumber(phoneNumber) {
  const digits = String(phoneNumber ?? '');
  return digits.length > 6 ? `${digits.slice(0, 3)}…${digits.slice(-4)}` : '***';
}

class UsageError extends Error {}

const UPSERT_SQL = `
  INSERT INTO "voice_caller_id_pool"
    ("phoneNumber", "countryCode", "provider", "status", "complianceStatus", "updatedAt")
  VALUES ($1, $2, 'twilio', $3::"VoiceCallerIdStatus", 'APPROVED', now())
  ON CONFLICT ("phoneNumber") DO UPDATE SET
    "countryCode" = EXCLUDED."countryCode",
    "status" = EXCLUDED."status",
    "complianceStatus" = EXCLUDED."complianceStatus",
    "updatedAt" = now()
  RETURNING (xmax = 0) AS inserted`;

const SUMMARY_SQL = `
  SELECT "countryCode", count(*)::int AS total,
         count(*) FILTER (WHERE "status" = 'ACTIVE' AND "complianceStatus" = 'APPROVED')::int AS in_rotation
  FROM "voice_caller_id_pool"
  GROUP BY "countryCode"
  ORDER BY "countryCode"`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const entries = parseCallerIdEntries(options.numbers ?? process.env.VOICE_CALLER_IDS);
  const databaseUrl = requireUrl('DATABASE_URL');

  console.log(`seed-caller-ids -> ${redactUrl(databaseUrl)}${options.dryRun ? ' (dry run)' : ''}`);
  for (const entry of entries) {
    console.log(`  ${maskNumber(entry.phoneNumber)}  ${entry.countryCode}  ${options.status}  APPROVED`);
  }
  if (options.dryRun) {
    return;
  }

  await withClient(databaseUrl, async (client) => {
    await client.query('BEGIN');
    try {
      let inserted = 0;
      let updated = 0;
      for (const entry of entries) {
        const { rows } = await client.query(UPSERT_SQL, [entry.phoneNumber, entry.countryCode, options.status]);
        if (rows[0]?.inserted) inserted += 1;
        else updated += 1;
      }
      await client.query('COMMIT');
      console.log(`  ${inserted} inserted, ${updated} updated`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }

    const { rows } = await client.query(SUMMARY_SQL);
    console.log('  pool by country (in rotation = ACTIVE and APPROVED):');
    for (const row of rows) {
      console.log(`    ${row.countryCode}  ${row.in_rotation}/${row.total}`);
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    if (error instanceof UsageError) {
      console.error(`seed-caller-ids: ${error.message}`);
      console.error(
        'usage: node scripts/db/seed-caller-ids.mjs --numbers=+1...[:US],+44... [--status=ACTIVE] [--dry-run]',
      );
      process.exit(2);
    }
    console.error(`seed-caller-ids failed: ${error.message}`);
    process.exit(1);
  });
