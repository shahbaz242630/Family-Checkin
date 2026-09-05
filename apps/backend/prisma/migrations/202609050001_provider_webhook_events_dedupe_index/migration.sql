-- Align the provider_webhook_events dedupe index with schema.prisma (@@index,
-- not @@unique) and with the partitioned table shape from
-- supabase/migrations/20260510181345_partitioned_operational_logs.sql: a
-- partitioned table cannot carry a unique index that omits the partition key
-- ("createdAt"), so the unique key created by 202605100001_twilio_voice_readiness
-- is replaced by a plain index. Idempotent; a no-op on databases where the
-- partition migration has already run.
DROP INDEX IF EXISTS "provider_webhook_events_provider_eventType_providerEventId_key";

CREATE INDEX IF NOT EXISTS "provider_webhook_events_provider_eventType_providerEventId_idx"
  ON "provider_webhook_events"("provider", "eventType", "providerEventId");
