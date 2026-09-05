-- Partition RLS hardening (2026-09-05).
--
-- Why this exists: PostgreSQL does not propagate ENABLE ROW LEVEL SECURITY
-- from a partitioned parent to its partitions. supabase/migrations/
-- 20260510181345_partitioned_operational_logs.sql enables RLS on the four
-- partitioned parents and on their `_default` partitions, but the 24 monthly
-- partitions per parent that `ensure_monthly_range_partitions` creates were
-- left with RLS disabled. Each partition is a regular table in `public`, so a
-- PostgREST client could read provider webhook payloads or archived attempt /
-- audit / escalation rows by addressing a monthly partition directly, bypassing
-- the parent's owner/co-monitor policies.
--
-- Access through the parent is unaffected: PostgreSQL applies the policies of
-- the table named in the query, so the parent's read policies keep working and
-- a partition with RLS enabled and no policies of its own is deny-by-default
-- for direct access (same posture as the internal-only tables, handoff §24).
-- The backend connects as the table owner and is not affected.
--
-- Applied by apps/backend/scripts/db/apply-all.mjs and recorded in
-- nearby_manual_sql_applied. Idempotent.

-- 1. Future partitions: same signature as the original, plus RLS on each
--    partition it creates.
CREATE OR REPLACE FUNCTION public.ensure_monthly_range_partitions(
  parent_table regclass,
  partition_column text,
  start_month date,
  month_count integer
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
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

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', parent_schema, partition_name);
  END LOOP;
END;
$$;

-- 2. Existing partitions: enable RLS on every partition (of any depth) whose
--    root parent in `public` already has RLS enabled.
DO $$
DECLARE
  partition_record record;
BEGIN
  FOR partition_record IN
    WITH RECURSIVE tree AS (
      SELECT c.oid AS root_oid, c.oid AS rel_oid
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'p'
        AND c.relrowsecurity
      UNION ALL
      SELECT tree.root_oid, i.inhrelid
      FROM tree
      JOIN pg_inherits i ON i.inhparent = tree.rel_oid
    )
    SELECT DISTINCT n.nspname, c.relname
    FROM tree
    JOIN pg_class c ON c.oid = tree.rel_oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relispartition
      AND NOT c.relrowsecurity
    ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', partition_record.nspname, partition_record.relname);
  END LOOP;
END
$$;

-- 3. Prisma's own bookkeeping table lives in `public` and is created without
--    RLS by `prisma migrate deploy`. The backend and Prisma connect as the
--    owner, so enabling RLS only closes it to PostgREST clients.
ALTER TABLE IF EXISTS public._prisma_migrations ENABLE ROW LEVEL SECURITY;
