ALTER TABLE IF EXISTS public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.channel_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.step_up_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.device_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'check_ins'
      AND policyname = 'check_ins_read_own'
  ) THEN
    CREATE POLICY check_ins_read_own ON public.check_ins
      FOR SELECT USING (
        "receiverId" IN (
          SELECT receivers.id
          FROM public.receivers
          WHERE receivers."userId" IN (
            SELECT users.id FROM public.users WHERE users."authProviderId" = auth.uid()::text
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'check_ins'
      AND policyname = 'check_ins_read_co_monitor'
  ) THEN
    CREATE POLICY check_ins_read_co_monitor ON public.check_ins
      FOR SELECT USING (
        "receiverId" IN (
          SELECT "receiverId" FROM public.co_monitors
          WHERE "userId" IN (SELECT id FROM public.users WHERE "authProviderId" = auth.uid()::text)
            AND "acceptedAt" IS NOT NULL
            AND "revokedAt" IS NULL
        )
      );
  END IF;
END
$$;
