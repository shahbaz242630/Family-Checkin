-- Twilio voice readiness: sticky caller IDs and provider event storage.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VoiceCallerIdStatus') THEN
    CREATE TYPE "VoiceCallerIdStatus" AS ENUM ('ACTIVE', 'DISABLED', 'COMPLIANCE_BLOCKED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "voice_caller_id_pool" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "phoneNumber" TEXT NOT NULL,
  "countryCode" CHAR(2) NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'twilio',
  "providerSid" TEXT,
  "status" "VoiceCallerIdStatus" NOT NULL DEFAULT 'ACTIVE',
  "complianceStatus" TEXT,
  "assignedCount" INTEGER NOT NULL DEFAULT 0,
  "lastAssignedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "voice_caller_id_pool_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "voice_caller_id_pool_phoneNumber_key"
  ON "voice_caller_id_pool"("phoneNumber");

CREATE INDEX IF NOT EXISTS "voice_caller_id_pool_countryCode_status_assignedCount_idx"
  ON "voice_caller_id_pool"("countryCode", "status", "assignedCount");

CREATE INDEX IF NOT EXISTS "voice_caller_id_pool_status_idx"
  ON "voice_caller_id_pool"("status");

CREATE TABLE IF NOT EXISTS "receiver_voice_caller_id_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "receiverId" UUID NOT NULL,
  "callerIdPoolId" UUID NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "releaseReason" TEXT,

  CONSTRAINT "receiver_voice_caller_id_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "receiver_voice_caller_id_assignments_receiverId_key"
  ON "receiver_voice_caller_id_assignments"("receiverId");

CREATE INDEX IF NOT EXISTS "receiver_voice_caller_id_assignments_callerIdPoolId_idx"
  ON "receiver_voice_caller_id_assignments"("callerIdPoolId");

CREATE INDEX IF NOT EXISTS "receiver_voice_caller_id_assignments_releasedAt_idx"
  ON "receiver_voice_caller_id_assignments"("releasedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receiver_voice_caller_id_assignments_receiverId_fkey'
  ) THEN
    ALTER TABLE "receiver_voice_caller_id_assignments"
      ADD CONSTRAINT "receiver_voice_caller_id_assignments_receiverId_fkey"
      FOREIGN KEY ("receiverId") REFERENCES "receivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receiver_voice_caller_id_assignments_callerIdPoolId_fkey'
  ) THEN
    ALTER TABLE "receiver_voice_caller_id_assignments"
      ADD CONSTRAINT "receiver_voice_caller_id_assignments_callerIdPoolId_fkey"
      FOREIGN KEY ("callerIdPoolId") REFERENCES "voice_caller_id_pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "provider_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "providerEventId" TEXT,
  "providerMessageId" TEXT,
  "checkInAttemptId" UUID,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_webhook_events_provider_eventType_providerEventId_key"
  ON "provider_webhook_events"("provider", "eventType", "providerEventId");

CREATE INDEX IF NOT EXISTS "provider_webhook_events_providerMessageId_idx"
  ON "provider_webhook_events"("providerMessageId");

CREATE INDEX IF NOT EXISTS "provider_webhook_events_eventType_receivedAt_idx"
  ON "provider_webhook_events"("eventType", "receivedAt");

CREATE INDEX IF NOT EXISTS "provider_webhook_events_createdAt_idx"
  ON "provider_webhook_events"("createdAt");

CREATE INDEX IF NOT EXISTS "provider_webhook_events_createdAt_brin_idx"
  ON "provider_webhook_events" USING BRIN ("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_webhook_events_checkInAttemptId_fkey'
  ) THEN
    ALTER TABLE "provider_webhook_events"
      ADD CONSTRAINT "provider_webhook_events_checkInAttemptId_fkey"
      FOREIGN KEY ("checkInAttemptId") REFERENCES "check_in_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "voice_caller_id_pool" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receiver_voice_caller_id_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_webhook_events" ENABLE ROW LEVEL SECURITY;

-- High-volume time indexes for append-heavy operational tables. These are not a
-- substitute for future date-range partitioning, but they keep scans efficient
-- until partition conversion is scheduled.
CREATE INDEX IF NOT EXISTS "check_in_attempts_scheduledAt_brin_idx"
  ON "check_in_attempts" USING BRIN ("scheduledAt");

CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_brin_idx"
  ON "audit_logs" USING BRIN ("createdAt");

CREATE INDEX IF NOT EXISTS "escalation_events_startedAt_brin_idx"
  ON "escalation_events" USING BRIN ("startedAt");
