-- CB-010: receivers and backup contacts read "your family member" / "their family member" because the sender's
-- own name was never stored. POST /auth/sync-user now keeps the Supabase user_metadata.full_name (fallback
-- name), trimmed and capped at 80 characters, encrypted with AES-256-GCM like every other name column, and the
-- message catalog fills senderDisplayName from it. NULL keeps today's neutral wording.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "displayNameEncrypted" TEXT;
