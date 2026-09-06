-- CB-023: Expo answers a push send with a ticket per message; whether the device actually received it, or no
-- longer exists (receipt error DeviceNotRegistered), only shows up in the receipt Expo makes available about
-- 15 minutes later. Accepted tickets are kept here until NotificationsService.processDuePushReceipts() has read
-- their receipt, deactivated the dead device token and deleted the row; a ticket without a receipt after 24 h is
-- dropped (Expo keeps receipts for about a day). "token" is the device token the ticket was issued for.
CREATE TABLE IF NOT EXISTS "expo_push_tickets" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ticketId"  text NOT NULL UNIQUE,
  "token"     text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "expo_push_tickets_createdAt_idx" ON "expo_push_tickets"("createdAt");

-- Backend-only, deny-by-default for PostgREST clients, like every other operational table (no policies).
ALTER TABLE "expo_push_tickets" ENABLE ROW LEVEL SECURITY;
