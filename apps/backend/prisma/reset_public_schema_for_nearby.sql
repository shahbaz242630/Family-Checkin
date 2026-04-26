-- Nearby database reset script
-- Generated for review. Do not run until approved.
-- Scope: drops app-owned public schema objects from the previous Family Check-In schema,
-- then creates the BRD-aligned Nearby schema and Supabase RLS/audit setup.
-- This does not delete auth.users or Supabase Auth configuration.

BEGIN;

-- The old trigger inserts into the old public.users shape, so remove it before resetting app tables.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Drop app-owned tables from both the old and new schemas. CASCADE removes dependent policies/indexes/FKs.
DROP TABLE IF EXISTS public.edge_rate_limits CASCADE;
DROP TABLE IF EXISTS public.device_tokens CASCADE;
DROP TABLE IF EXISTS public.escalation_events CASCADE;
DROP TABLE IF EXISTS public.escalation_plans CASCADE;
DROP TABLE IF EXISTS public.checkins CASCADE;
DROP TABLE IF EXISTS public.checkin_schedules CASCADE;
DROP TABLE IF EXISTS public.pairing_codes CASCADE;
DROP TABLE IF EXISTS public.relationships CASCADE;
DROP TABLE IF EXISTS public.loved_one_profiles CASCADE;
DROP TABLE IF EXISTS public.contact_points CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

DROP TABLE IF EXISTS public.idempotency_keys CASCADE;
DROP TABLE IF EXISTS public.channel_templates CASCADE;
DROP TABLE IF EXISTS public.admin_users CASCADE;
DROP TABLE IF EXISTS public.opt_out_cooldowns CASCADE;
DROP TABLE IF EXISTS public.abuse_reports CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.backup_contacts CASCADE;
DROP TABLE IF EXISTS public.co_monitors CASCADE;
DROP TABLE IF EXISTS public.check_ins CASCADE;
DROP TABLE IF EXISTS public.receivers CASCADE;

-- Drop old helper functions and reset-time helpers.
DROP FUNCTION IF EXISTS public.increment_rate_limit(text, uuid, text, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.prevent_audit_log_modification() CASCADE;

-- Drop old enum types.
DROP TYPE IF EXISTS public.relationship_type CASCADE;
DROP TYPE IF EXISTS public.relationship_mode CASCADE;
DROP TYPE IF EXISTS public.subscription_tier CASCADE;
DROP TYPE IF EXISTS public.subscription_status CASCADE;
DROP TYPE IF EXISTS public.checkin_status CASCADE;
DROP TYPE IF EXISTS public.escalation_channel CASCADE;
DROP TYPE IF EXISTS public.response_method CASCADE;
DROP TYPE IF EXISTS public.pairing_code_status CASCADE;
DROP TYPE IF EXISTS public.platform_type CASCADE;
DROP TYPE IF EXISTS public.supported_language CASCADE;

-- Drop new enum types if this reset is rerun.
DROP TYPE IF EXISTS public."SubscriptionTier" CASCADE;
DROP TYPE IF EXISTS public."SubscriptionStatus" CASCADE;
DROP TYPE IF EXISTS public."RelationshipType" CASCADE;
DROP TYPE IF EXISTS public."TechProfile" CASCADE;
DROP TYPE IF EXISTS public."Channel" CASCADE;
DROP TYPE IF EXISTS public."ConsentStatus" CASCADE;
DROP TYPE IF EXISTS public."CheckInStatus" CASCADE;
DROP TYPE IF EXISTS public."EscalationResult" CASCADE;
DROP TYPE IF EXISTS public."AbuseReportStatus" CASCADE;
DROP TYPE IF EXISTS public."ActorType" CASCADE;
DROP TYPE IF EXISTS public."AdminRole" CASCADE;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('PARENT', 'GRANDPARENT', 'SIBLING', 'SPOUSE', 'CHILD', 'FRIEND', 'OTHER');

-- CreateEnum
CREATE TYPE "TechProfile" AS ENUM ('WHATSAPP', 'SMS', 'VOICE_ONLY');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WHATSAPP', 'SMS', 'VOICE');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'GRANTED', 'DECLINED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('PENDING', 'SENT', 'RESPONDED_OK', 'RESPONDED_HELP', 'ESCALATED', 'RESOLVED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EscalationResult" AS ENUM ('SUCCESS', 'NO_RESPONSE', 'ERROR');

-- CreateEnum
CREATE TYPE "AbuseReportStatus" AS ENUM ('PENDING', 'REVIEWED_SAFE', 'REVIEWED_ACTION_TAKEN');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'ADMIN');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'OPERATOR', 'SUPPORT_READONLY');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "emailEncrypted" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "phoneEncrypted" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "preferredLanguage" CHAR(5) NOT NULL,
    "timezone" TEXT NOT NULL,
    "authProviderId" TEXT,
    "stripeCustomerId" TEXT,
    "telrCustomerId" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "nameEncrypted" TEXT NOT NULL,
    "phoneEncrypted" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "relationshipType" "RelationshipType" NOT NULL,
    "language" CHAR(5) NOT NULL,
    "timezone" TEXT NOT NULL,
    "techProfile" "TechProfile" NOT NULL,
    "primaryChannel" "Channel" NOT NULL,
    "fallbackChannels" "Channel"[],
    "scheduleFrequency" TEXT NOT NULL,
    "scheduleTimeWindow" JSONB NOT NULL,
    "scheduleCustomCron" TEXT,
    "personalNoteEncrypted" TEXT,
    "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "consentRequestedAt" TIMESTAMP(3),
    "consentGrantedAt" TIMESTAMP(3),
    "consentRevokedAt" TIMESTAMP(3),
    "consentTranscript" TEXT,
    "pausedUntil" TIMESTAMP(3),
    "pausedReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receiverId" UUID NOT NULL,
    "nameEncrypted" TEXT NOT NULL,
    "phoneEncrypted" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "relationshipToReceiver" TEXT NOT NULL,
    "locationInstructionsEncrypted" TEXT,
    "priorityOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "co_monitors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receiverId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "co_monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_ins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receiverId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "CheckInStatus" NOT NULL DEFAULT 'PENDING',
    "channelUsed" "Channel",
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "responseTranscript" TEXT,
    "responseDetectedAs" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "resolutionByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checkInId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "channel" "Channel" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "result" "EscalationResult",
    "errorDetails" TEXT,
    "senderNotifiedAt" TIMESTAMP(3),
    "backupAlertedAt" TIMESTAMP(3),

    CONSTRAINT "escalation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "paymentProvider" TEXT NOT NULL,
    "externalSubscriptionId" TEXT NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abuse_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receiverId" UUID NOT NULL,
    "reporterPhoneHash" TEXT NOT NULL,
    "reportContent" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStatus" "AbuseReportStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerAdminId" UUID,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "abuse_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opt_out_cooldowns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receiverId" UUID NOT NULL,
    "optOutAt" TIMESTAMP(3) NOT NULL,
    "cooldownUntil" TIMESTAMP(3) NOT NULL,
    "optOutChannel" "Channel" NOT NULL,
    "optOutKeyword" TEXT,

    CONSTRAINT "opt_out_cooldowns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "authProviderId" TEXT NOT NULL,
    "emailEncrypted" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "templateKey" TEXT NOT NULL,
    "language" CHAR(5) NOT NULL,
    "channel" "Channel" NOT NULL,
    "externalId" TEXT,
    "bodyText" TEXT NOT NULL,
    "variables" TEXT[],
    "approvedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "userId" UUID,
    "scope" TEXT NOT NULL,
    "responseBody" JSONB,
    "statusCode" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_emailHash_key" ON "users"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneHash_key" ON "users"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "users_authProviderId_key" ON "users"("authProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "users_telrCustomerId_key" ON "users"("telrCustomerId");

-- CreateIndex
CREATE INDEX "users_emailHash_idx" ON "users"("emailHash");

-- CreateIndex
CREATE INDEX "users_phoneHash_idx" ON "users"("phoneHash");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE INDEX "receivers_userId_idx" ON "receivers"("userId");

-- CreateIndex
CREATE INDEX "receivers_phoneHash_idx" ON "receivers"("phoneHash");

-- CreateIndex
CREATE INDEX "receivers_consentStatus_idx" ON "receivers"("consentStatus");

-- CreateIndex
CREATE INDEX "receivers_deletedAt_idx" ON "receivers"("deletedAt");

-- CreateIndex
CREATE INDEX "backup_contacts_receiverId_idx" ON "backup_contacts"("receiverId");

-- CreateIndex
CREATE INDEX "co_monitors_userId_idx" ON "co_monitors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "co_monitors_receiverId_userId_key" ON "co_monitors"("receiverId", "userId");

-- CreateIndex
CREATE INDEX "check_ins_receiverId_scheduledAt_idx" ON "check_ins"("receiverId", "scheduledAt");

-- CreateIndex
CREATE INDEX "check_ins_status_idx" ON "check_ins"("status");

-- CreateIndex
CREATE INDEX "check_ins_scheduledAt_idx" ON "check_ins"("scheduledAt");

-- CreateIndex
CREATE INDEX "escalation_events_checkInId_idx" ON "escalation_events"("checkInId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_externalSubscriptionId_key" ON "subscriptions"("externalSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_userId_status_idx" ON "subscriptions"("userId", "status");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "abuse_reports_reviewStatus_idx" ON "abuse_reports"("reviewStatus");

-- CreateIndex
CREATE INDEX "abuse_reports_receiverId_idx" ON "abuse_reports"("receiverId");

-- CreateIndex
CREATE UNIQUE INDEX "opt_out_cooldowns_receiverId_key" ON "opt_out_cooldowns"("receiverId");

-- CreateIndex
CREATE INDEX "opt_out_cooldowns_cooldownUntil_idx" ON "opt_out_cooldowns"("cooldownUntil");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_authProviderId_key" ON "admin_users"("authProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_emailHash_key" ON "admin_users"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "channel_templates_templateKey_language_channel_key" ON "channel_templates"("templateKey", "language", "channel");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- AddForeignKey
ALTER TABLE "receivers" ADD CONSTRAINT "receivers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_contacts" ADD CONSTRAINT "backup_contacts_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "receivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "co_monitors" ADD CONSTRAINT "co_monitors_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "receivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "co_monitors" ADD CONSTRAINT "co_monitors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "receivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "check_ins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "receivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opt_out_cooldowns" ADD CONSTRAINT "opt_out_cooldowns_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "receivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase-specific setup from prisma/supabase_setup.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE receivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE co_monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE abuse_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE opt_out_cooldowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_read_own ON users
  FOR SELECT USING ("authProviderId" = auth.uid()::text);

CREATE POLICY receivers_read_own ON receivers
  FOR SELECT USING (
    "userId" IN (
      SELECT id FROM users WHERE "authProviderId" = auth.uid()::text
    )
  );

CREATE POLICY receivers_modify_own ON receivers
  FOR ALL USING (
    "userId" IN (
      SELECT id FROM users WHERE "authProviderId" = auth.uid()::text
    )
  );

CREATE POLICY receivers_read_co_monitor ON receivers
  FOR SELECT USING (
    id IN (
      SELECT "receiverId" FROM co_monitors
      WHERE "userId" IN (SELECT id FROM users WHERE "authProviderId" = auth.uid()::text)
        AND "acceptedAt" IS NOT NULL
        AND "revokedAt" IS NULL
    )
  );

CREATE POLICY audit_logs_read_own ON audit_logs
  FOR SELECT USING (
    "actorId" IN (SELECT id FROM users WHERE "authProviderId" = auth.uid()::text)
    OR (
      "entityType" = 'user'
      AND "entityId" IN (SELECT id FROM users WHERE "authProviderId" = auth.uid()::text)
    )
  );

CREATE INDEX idx_checkins_pending_scheduled
  ON check_ins ("scheduledAt")
  WHERE status = 'PENDING';

CREATE INDEX idx_subscriptions_active
  ON subscriptions ("userId")
  WHERE status IN ('TRIALING', 'ACTIVE');

COMMIT;
