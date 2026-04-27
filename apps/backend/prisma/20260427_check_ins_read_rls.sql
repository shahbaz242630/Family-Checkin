ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS check_ins_read_own ON check_ins;
CREATE POLICY check_ins_read_own ON check_ins
  FOR SELECT USING (
    "receiverId" IN (
      SELECT receivers.id
      FROM receivers
      WHERE receivers."userId" IN (
        SELECT users.id FROM users WHERE users."authProviderId" = auth.uid()::text
      )
    )
  );

DROP POLICY IF EXISTS check_ins_read_co_monitor ON check_ins;
CREATE POLICY check_ins_read_co_monitor ON check_ins
  FOR SELECT USING (
    "receiverId" IN (
      SELECT "receiverId" FROM co_monitors
      WHERE "userId" IN (SELECT id FROM users WHERE "authProviderId" = auth.uid()::text)
        AND "acceptedAt" IS NOT NULL
        AND "revokedAt" IS NULL
    )
  );
