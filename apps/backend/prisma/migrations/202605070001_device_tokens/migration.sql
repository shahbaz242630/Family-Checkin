CREATE TABLE "device_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" text NOT NULL UNIQUE,
  "platform" text NOT NULL,
  "deviceId" text,
  "active" boolean NOT NULL DEFAULT true,
  "lastRegisteredAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "device_tokens_userId_active_idx" ON "device_tokens"("userId", "active");
CREATE INDEX "device_tokens_lastRegisteredAt_idx" ON "device_tokens"("lastRegisteredAt");
