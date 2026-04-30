ALTER FUNCTION public.prevent_audit_log_modification()
SET search_path = public, pg_temp;

CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
