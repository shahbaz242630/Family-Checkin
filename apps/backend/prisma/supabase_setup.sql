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
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY check_ins_read_co_monitor ON check_ins
  FOR SELECT USING (
    "receiverId" IN (
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
