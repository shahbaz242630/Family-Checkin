-- Partitioned operational logs for high-volume Twilio/check-in telemetry.
--
-- Important design boundary:
-- - Core Prisma-managed tables (`check_in_attempts`, `audit_logs`,
--   `escalation_events`) keep their current UUID primary keys for application
--   compatibility.
-- - High-volume provider webhook telemetry is converted to native monthly
--   partitions while it is still empty/new.
-- - Archive tables are native monthly partitions and are intended for retention
--   jobs once hot operational rows age out.
--
-- PostgreSQL requires every unique/primary key on a partitioned table to include
-- the partition key. That is why partitioned log/archive tables use composite
-- keys such as ("createdAt", "id") instead of UUID-only primary keys.

CREATE OR REPLACE FUNCTION public.ensure_monthly_range_partitions(
  parent_table regclass,
  partition_column text,
  start_month date,
  month_count integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  parent_schema text;
  parent_name text;
  partition_start date;
  partition_end date;
  partition_name text;
  partition_index integer;
BEGIN
  IF month_count <= 0 THEN
    RAISE EXCEPTION 'month_count must be positive';
  END IF;

  SELECT n.nspname, c.relname
    INTO parent_schema, parent_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = parent_table;

  FOR partition_index IN 0..(month_count - 1) LOOP
    partition_start := date_trunc('month', start_month)::date + (partition_index || ' months')::interval;
    partition_end := partition_start + interval '1 month';
    partition_name := parent_name || '_' || to_char(partition_start, 'YYYYMM');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.%I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
      parent_schema,
      partition_name,
      parent_table,
      partition_start,
      partition_end
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  provider_events_kind "char";
  provider_events_count bigint;
BEGIN
  SELECT c.relkind
    INTO provider_events_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'provider_webhook_events';

  IF provider_events_kind = 'p' THEN
    RETURN;
  END IF;

  IF provider_events_kind = 'r' THEN
    SELECT count(*) INTO provider_events_count FROM public.provider_webhook_events;

    IF provider_events_count > 0 THEN
      RAISE EXCEPTION
        'provider_webhook_events already has % rows; convert in a maintenance window with copy/swap migration',
        provider_events_count;
    END IF;

    DROP INDEX IF EXISTS public."provider_webhook_events_provider_eventType_providerEventId_key";
    DROP INDEX IF EXISTS public."provider_webhook_events_providerMessageId_idx";
    DROP INDEX IF EXISTS public."provider_webhook_events_eventType_receivedAt_idx";
    DROP INDEX IF EXISTS public."provider_webhook_events_createdAt_idx";
    DROP INDEX IF EXISTS public."provider_webhook_events_createdAt_brin_idx";
    DROP TABLE public.provider_webhook_events;
  END IF;

  CREATE TABLE public.provider_webhook_events (
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

    CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("createdAt", "id")
  ) PARTITION BY RANGE ("createdAt");
END $$;

CREATE INDEX IF NOT EXISTS "provider_webhook_events_providerMessageId_idx"
  ON public.provider_webhook_events("providerMessageId");

CREATE INDEX IF NOT EXISTS "provider_webhook_events_provider_eventType_providerEventId_idx"
  ON public.provider_webhook_events("provider", "eventType", "providerEventId");

CREATE INDEX IF NOT EXISTS "provider_webhook_events_eventType_receivedAt_idx"
  ON public.provider_webhook_events("eventType", "receivedAt");

CREATE INDEX IF NOT EXISTS "provider_webhook_events_createdAt_brin_idx"
  ON public.provider_webhook_events USING BRIN ("createdAt");

CREATE TABLE IF NOT EXISTS public.provider_webhook_events_default
  PARTITION OF public.provider_webhook_events DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_webhook_events_checkInAttemptId_fkey'
  ) THEN
    ALTER TABLE public.provider_webhook_events
      ADD CONSTRAINT "provider_webhook_events_checkInAttemptId_fkey"
      FOREIGN KEY ("checkInAttemptId") REFERENCES public.check_in_attempts("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE public.provider_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_webhook_events_default ENABLE ROW LEVEL SECURITY;

SELECT public.ensure_monthly_range_partitions(
  'public.provider_webhook_events'::regclass,
  'createdAt',
  date_trunc('month', CURRENT_DATE)::date,
  24
);

CREATE TABLE IF NOT EXISTS public.check_in_attempts_archive (
  LIKE public.check_in_attempts INCLUDING DEFAULTS INCLUDING GENERATED,
  CONSTRAINT "check_in_attempts_archive_pkey" PRIMARY KEY ("scheduledAt", "id")
) PARTITION BY RANGE ("scheduledAt");

CREATE INDEX IF NOT EXISTS "check_in_attempts_archive_checkInId_idx"
  ON public.check_in_attempts_archive("checkInId");

CREATE INDEX IF NOT EXISTS "check_in_attempts_archive_status_scheduledAt_idx"
  ON public.check_in_attempts_archive("status", "scheduledAt");

ALTER TABLE public.check_in_attempts_archive ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.check_in_attempts_archive_default
  PARTITION OF public.check_in_attempts_archive DEFAULT;

ALTER TABLE public.check_in_attempts_archive_default ENABLE ROW LEVEL SECURITY;

CREATE POLICY check_in_attempts_archive_read_own ON public.check_in_attempts_archive
  FOR SELECT USING (
    "checkInId" IN (
      SELECT check_ins.id
      FROM public.check_ins
      JOIN public.receivers ON receivers.id = check_ins."receiverId"
      WHERE receivers."userId" IN (
        SELECT users.id FROM public.users WHERE users."authProviderId" = auth.uid()::text
      )
    )
  );

CREATE POLICY check_in_attempts_archive_read_co_monitor ON public.check_in_attempts_archive
  FOR SELECT USING (
    "checkInId" IN (
      SELECT check_ins.id
      FROM public.check_ins
      WHERE check_ins."receiverId" IN (
        SELECT "receiverId" FROM public.co_monitors
        WHERE "userId" IN (SELECT id FROM public.users WHERE "authProviderId" = auth.uid()::text)
          AND "acceptedAt" IS NOT NULL
          AND "revokedAt" IS NULL
      )
    )
  );

SELECT public.ensure_monthly_range_partitions(
  'public.check_in_attempts_archive'::regclass,
  'scheduledAt',
  date_trunc('month', CURRENT_DATE)::date,
  24
);

CREATE TABLE IF NOT EXISTS public.audit_logs_archive (
  LIKE public.audit_logs INCLUDING DEFAULTS INCLUDING GENERATED,
  CONSTRAINT "audit_logs_archive_pkey" PRIMARY KEY ("createdAt", "id")
) PARTITION BY RANGE ("createdAt");

CREATE INDEX IF NOT EXISTS "audit_logs_archive_entityType_entityId_idx"
  ON public.audit_logs_archive("entityType", "entityId");

CREATE INDEX IF NOT EXISTS "audit_logs_archive_actorId_idx"
  ON public.audit_logs_archive("actorId");

ALTER TABLE public.audit_logs_archive ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.audit_logs_archive_default
  PARTITION OF public.audit_logs_archive DEFAULT;

ALTER TABLE public.audit_logs_archive_default ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_archive_read_own ON public.audit_logs_archive
  FOR SELECT USING (
    "actorId" IN (SELECT id FROM public.users WHERE "authProviderId" = auth.uid()::text)
    OR (
      "entityType" = 'user'
      AND "entityId" IN (SELECT id FROM public.users WHERE "authProviderId" = auth.uid()::text)
    )
  );

SELECT public.ensure_monthly_range_partitions(
  'public.audit_logs_archive'::regclass,
  'createdAt',
  date_trunc('month', CURRENT_DATE)::date,
  24
);

CREATE TABLE IF NOT EXISTS public.escalation_events_archive (
  LIKE public.escalation_events INCLUDING DEFAULTS INCLUDING GENERATED,
  CONSTRAINT "escalation_events_archive_pkey" PRIMARY KEY ("startedAt", "id")
) PARTITION BY RANGE ("startedAt");

CREATE INDEX IF NOT EXISTS "escalation_events_archive_checkInId_idx"
  ON public.escalation_events_archive("checkInId");

ALTER TABLE public.escalation_events_archive ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.escalation_events_archive_default
  PARTITION OF public.escalation_events_archive DEFAULT;

ALTER TABLE public.escalation_events_archive_default ENABLE ROW LEVEL SECURITY;

SELECT public.ensure_monthly_range_partitions(
  'public.escalation_events_archive'::regclass,
  'startedAt',
  date_trunc('month', CURRENT_DATE)::date,
  24
);

CREATE OR REPLACE FUNCTION public.archive_operational_logs_before(cutoff_timestamp timestamp)
RETURNS TABLE (
  check_in_attempts_archived integer,
  audit_logs_archived integer,
  escalation_events_archived integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH candidates AS (
    SELECT *
    FROM public.check_in_attempts
    WHERE "scheduledAt" < cutoff_timestamp
  ),
  inserted AS (
    INSERT INTO public.check_in_attempts_archive
    SELECT * FROM candidates
    ON CONFLICT DO NOTHING
    RETURNING "id"
  ),
  deleted AS (
    DELETE FROM public.check_in_attempts source
    USING inserted
    WHERE source."id" = inserted."id"
    RETURNING 1
  )
  SELECT count(*)::integer INTO check_in_attempts_archived FROM deleted;

  WITH candidates AS (
    SELECT *
    FROM public.audit_logs
    WHERE "createdAt" < cutoff_timestamp
  ),
  inserted AS (
    INSERT INTO public.audit_logs_archive
    SELECT * FROM candidates
    ON CONFLICT DO NOTHING
    RETURNING "id"
  ),
  deleted AS (
    DELETE FROM public.audit_logs source
    USING inserted
    WHERE source."id" = inserted."id"
    RETURNING 1
  )
  SELECT count(*)::integer INTO audit_logs_archived FROM deleted;

  WITH candidates AS (
    SELECT *
    FROM public.escalation_events
    WHERE "startedAt" < cutoff_timestamp
  ),
  inserted AS (
    INSERT INTO public.escalation_events_archive
    SELECT * FROM candidates
    ON CONFLICT DO NOTHING
    RETURNING "id"
  ),
  deleted AS (
    DELETE FROM public.escalation_events source
    USING inserted
    WHERE source."id" = inserted."id"
    RETURNING 1
  )
  SELECT count(*)::integer INTO escalation_events_archived FROM deleted;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_operational_logs_before(timestamp) FROM PUBLIC;

COMMENT ON FUNCTION public.archive_operational_logs_before(timestamp)
  IS 'Moves old hot operational log rows into monthly partitioned archive tables. Run from a trusted backend/maintenance role only.';
