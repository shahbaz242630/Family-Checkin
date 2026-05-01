-- Add needs-attention summary status for exhausted receiver cascades.
ALTER TYPE "CheckInStatus" ADD VALUE IF NOT EXISTS 'NEEDS_ATTENTION';

-- Create receiver-channel attempt status enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CheckInAttemptStatus') THEN
    CREATE TYPE "CheckInAttemptStatus" AS ENUM ('PENDING', 'SENT', 'RESPONDED', 'FAILED', 'TIMED_OUT', 'SKIPPED');
  END IF;
END $$;

-- Create dedicated receiver cascade attempt timeline.
CREATE TABLE IF NOT EXISTS "check_in_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "checkInId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "channel" "Channel" NOT NULL,
  "status" "CheckInAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "providerStatus" TEXT,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "check_in_attempts_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_in_attempts_checkInId_fkey'
  ) THEN
    ALTER TABLE "check_in_attempts"
      ADD CONSTRAINT "check_in_attempts_checkInId_fkey"
      FOREIGN KEY ("checkInId") REFERENCES "check_ins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "check_in_attempts_checkInId_attemptNumber_key"
  ON "check_in_attempts"("checkInId", "attemptNumber");

CREATE INDEX IF NOT EXISTS "check_in_attempts_checkInId_idx"
  ON "check_in_attempts"("checkInId");

CREATE INDEX IF NOT EXISTS "check_in_attempts_status_scheduledAt_idx"
  ON "check_in_attempts"("status", "scheduledAt");

ALTER TABLE "check_in_attempts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY check_in_attempts_read_own ON check_in_attempts
  FOR SELECT USING (
    "checkInId" IN (
      SELECT check_ins.id
      FROM check_ins
      JOIN receivers ON receivers.id = check_ins."receiverId"
      WHERE receivers."userId" IN (
        SELECT users.id FROM users WHERE users."authProviderId" = auth.uid()::text
      )
    )
  );

CREATE POLICY check_in_attempts_read_co_monitor ON check_in_attempts
  FOR SELECT USING (
    "checkInId" IN (
      SELECT check_ins.id
      FROM check_ins
      WHERE check_ins."receiverId" IN (
        SELECT "receiverId" FROM co_monitors
        WHERE "userId" IN (SELECT id FROM users WHERE "authProviderId" = auth.uid()::text)
          AND "acceptedAt" IS NOT NULL
          AND "revokedAt" IS NULL
      )
    )
  );
