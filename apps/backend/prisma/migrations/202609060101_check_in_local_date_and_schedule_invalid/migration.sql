-- CB-013: the daily dedupe used the UTC calendar day, so a receiver whose window straddles UTC midnight
-- (America/Los_Angeles 16:00-18:00 is 23:00-01:00Z in summer) could get two check-ins in one evening, and a
-- sender "try later" row that landed on the next UTC day suppressed the following day's real check-in. Every
-- check-in now records the receiver's local schedule day and, for try-later rows, the check-in it retries; only
-- non-retry rows take part in the dedupe.
ALTER TABLE "check_ins" ADD COLUMN IF NOT EXISTS "scheduledLocalDate" DATE;
ALTER TABLE "check_ins" ADD COLUMN IF NOT EXISTS "retryOf" UUID;

-- Backfill. The receiver's local day cannot be derived in plain SQL for every row: a stored timezone that
-- PostgreSQL cannot resolve (the 'Dubai' rows CB-004 taught the cron to skip) would abort the migration. Existing
-- rows therefore keep the UTC calendar day they were deduped on. "scheduledAt" is TIMESTAMP(3) WITHOUT TIME ZONE
-- holding UTC, so a plain ::date cast is that UTC day regardless of the session TimeZone (casting through
-- timestamptz, e.g. ("scheduledAt" AT TIME ZONE 'UTC')::date, would follow the session zone instead).
UPDATE "check_ins"
SET "scheduledLocalDate" = "scheduledAt"::date
WHERE "scheduledLocalDate" IS NULL;

ALTER TABLE "check_ins" ALTER COLUMN "scheduledLocalDate" SET NOT NULL;

-- Rows that already share a (receiver, day) -- the double-sends and same-day try-later rows this migration exists
-- to stop -- become retries of the earliest row for that day, so the unique index below can be built.
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER w AS first_id,
    row_number() OVER w AS position
  FROM "check_ins"
  WHERE "retryOf" IS NULL
  WINDOW w AS (PARTITION BY "receiverId", "scheduledLocalDate" ORDER BY "scheduledAt", "createdAt", id)
)
UPDATE "check_ins" AS c
SET "retryOf" = ranked.first_id
FROM ranked
WHERE c.id = ranked.id AND ranked.position > 1;

-- One non-retry check-in per receiver per local day. The index is partial (WHERE "retryOf" IS NULL): retry rows
-- are exempt by design. schema.prisma cannot express a partial index, so this statement is the only place it
-- lives; the repository translates its violation into CheckInAlreadyScheduledError.
CREATE UNIQUE INDEX IF NOT EXISTS "check_ins_receiverId_scheduledLocalDate_key"
  ON "check_ins" ("receiverId", "scheduledLocalDate")
  WHERE "retryOf" IS NULL;

-- CB-069: check_in.schedule_invalid was audited on every 10-minute tick for a receiver whose stored timezone or
-- window cannot be evaluated (about 144 rows a day). The cron now stamps the first sighting here, audits only when
-- the stamp flips from NULL, and clears it once the schedule evaluates again.
ALTER TABLE "receivers" ADD COLUMN IF NOT EXISTS "scheduleInvalidAt" TIMESTAMP(3);
