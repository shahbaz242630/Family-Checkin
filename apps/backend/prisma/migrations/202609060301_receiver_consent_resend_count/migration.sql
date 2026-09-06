-- CB-081: the consent resend window counted the first invitation toward the 7-day cap, so a sender who added a
-- receiver today could not resend for a week. Founder decision 2026-09-06: the first invitation never counts,
-- one resend opens 24 hours after it, and each resend closes the window for 7 days. "consentRequestedAt" keeps
-- the time of the latest send (first or resend); this counter says whether a resend has happened yet.
ALTER TABLE "receivers" ADD COLUMN IF NOT EXISTS "consentResendCount" INTEGER NOT NULL DEFAULT 0;
