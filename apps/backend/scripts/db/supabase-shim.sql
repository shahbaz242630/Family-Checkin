-- Minimal stand-in for the parts of a Supabase project that the Nearby SQL
-- depends on, for plain PostgreSQL servers (CI service container, local
-- throwaway databases).
--
-- apply-all.mjs and drift-check.mjs install this ONLY when `auth.uid()` does
-- not exist, so it is never applied to a real Supabase database.
--
-- What the repo SQL needs from Supabase:
--   * auth.uid()            used by every RLS policy (supabase_setup.sql,
--                           20260427_check_ins_read_rls.sql,
--                           20260509_existing_surface_rls_hardening.sql,
--                           supabase/migrations/20260510181345_*.sql) and by
--                           prisma/migrations/202605010001_check_in_attempts.
--   * `extensions` schema   Supabase preinstalls pgcrypto and uuid-ossp there;
--                           supabase_setup.sql's CREATE EXTENSION IF NOT EXISTS
--                           is then a no-op, exactly like on the hosted project,
--                           and `public` stays free of extensions
--                           (Security Advisor `extension_in_public`, handoff §25).
--   * anon / authenticated / service_role roles  not referenced by any SQL
--                           today; created so future `TO authenticated`
--                           policies or GRANTs apply cleanly.

DO $$
BEGIN
  IF (SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      CREATE ROLE anon NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      CREATE ROLE authenticated NOLOGIN NOINHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    END IF;
  ELSE
    RAISE NOTICE 'supabase-shim: current user cannot CREATE ROLE; skipping anon/authenticated/service_role';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- Same contract as Supabase's auth.uid(): the `sub` claim of the current
-- request's JWT (set by PostgREST as request.jwt.claim.sub / request.jwt.claims),
-- or NULL when there is no user context.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;
