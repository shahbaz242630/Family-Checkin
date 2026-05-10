CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');
CREATE TYPE "BillingStore" AS ENUM ('APP_STORE', 'PLAY_STORE', 'STRIPE', 'PROMOTIONAL', 'UNKNOWN');

ALTER TABLE "subscriptions"
  ADD COLUMN "externalProductId" TEXT,
  ADD COLUMN "revenueCatAppUserId" TEXT,
  ADD COLUMN "billingInterval" "BillingInterval",
  ADD COLUMN "store" "BillingStore",
  ADD COLUMN "willRenew" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "subscriptions_revenueCatAppUserId_idx" ON "subscriptions"("revenueCatAppUserId");
