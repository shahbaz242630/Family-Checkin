-- CB-016: provider_webhook_events stored duplicates because the natural-key index became non-unique in
-- 202609050001_provider_webhook_events_dedupe_index. It had to: supabase/migrations/20260510181345 partitions
-- provider_webhook_events BY RANGE ("createdAt"), and PostgreSQL rejects a unique index on a partitioned table
-- unless it includes every partition column ("createdAt" here), which would defeat the purpose. The unique
-- constraint therefore lives in a small non-partitioned registry of the natural key the repository already
-- dedupes on, (provider, eventType, providerEventId). The repository claims the key with
-- INSERT ... ON CONFLICT DO NOTHING inside the same transaction as the event row: a replayed provider event
-- (Twilio retry, duplicate status callback, overlapping deliveries) stores exactly one row and is reported as
-- not created, whatever the partition layout of the events table.
CREATE TABLE IF NOT EXISTS "provider_webhook_event_keys" (
  "provider"        TEXT NOT NULL,
  "eventType"       TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_webhook_event_keys_pkey" PRIMARY KEY ("provider", "eventType", "providerEventId")
);

-- Backend-only, deny-by-default for PostgREST clients, like every other operational table (no policies).
ALTER TABLE "provider_webhook_event_keys" ENABLE ROW LEVEL SECURITY;

-- Register the keys of events already stored so a late replay of one of them is recognised. Duplicates that
-- exist today collapse to one key; the surplus event rows are left in place as history.
INSERT INTO "provider_webhook_event_keys" ("provider", "eventType", "providerEventId", "createdAt")
SELECT "provider", "eventType", "providerEventId", min("createdAt")
FROM "provider_webhook_events"
WHERE "providerEventId" IS NOT NULL
GROUP BY "provider", "eventType", "providerEventId"
ON CONFLICT DO NOTHING;
