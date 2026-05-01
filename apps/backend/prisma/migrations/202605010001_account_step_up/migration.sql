CREATE TYPE "SensitiveAction" AS ENUM ('EXPORT_DATA', 'DELETE_ACCOUNT');

CREATE TABLE "step_up_challenges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "action" "SensitiveAction" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "tokenHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "tokenExpiresAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "step_up_challenges_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "step_up_challenges"
ADD CONSTRAINT "step_up_challenges_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "step_up_challenges_userId_action_expiresAt_idx"
ON "step_up_challenges"("userId", "action", "expiresAt");

CREATE INDEX "step_up_challenges_tokenHash_idx"
ON "step_up_challenges"("tokenHash");
